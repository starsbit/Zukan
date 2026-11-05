from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import logging
import time
from collections.abc import Awaitable, Callable

import numpy as np
import pandas as pd
from huggingface_hub import hf_hub_download
from PIL import Image

from backend.app.config import settings
from backend.app.utils.tagging import (
    NSFW_RATING_TAGS,
    TagPrediction,
    TaggerBackendName,
    TaggingResult,
    tag_names_mark_nsfw,
)

_executor = ThreadPoolExecutor(max_workers=settings.tagger_executor_workers)
logger = logging.getLogger(__name__)

PIXAI_CATEGORY_IDS = {"general": 0, "character": 4, "copyright": 3, "style": 1}
PIXAI_RATING_NAMES = {
    "rating:g": "general",
    "rating:s": "sensitive",
    "rating:q": "questionable",
    "rating:e": "explicit",
}
TAGGER_OPTIONS = {
    TaggerBackendName.wd_v3.value: {
        "label": "WD ViT Tagger v3",
        "description": "The default tagger.",
        "download_size_bytes": 380_000_000,
    },
    TaggerBackendName.pixai_v1_336_int8.value: {
        "label": "PixAI v1.0 336px INT8",
        "description": "Community fine-tune of PixAI Tagger v1.0 with a larger tag vocabulary, built for CPU use.",
        "download_size_bytes": 494_000_000,
    },
}


class _OnnxTagger:
    def __init__(self):
        self._session = None
        self._input_name: str | None = None
        self._input_size: int = 448
        self.execution_provider: str | None = None

    def _create_session(self, model_path: str):
        import onnxruntime as rt

        available_providers = list(rt.get_available_providers())
        preferred_providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        providers = [provider for provider in preferred_providers if provider in available_providers]
        if not providers:
            providers = ["CPUExecutionProvider"]
        logger.info(
            "Tagger inference session creation started available_providers=%s selected_providers=%s",
            available_providers,
            providers,
        )
        session_options = rt.SessionOptions()
        session_options.intra_op_num_threads = max(1, settings.tagger_executor_workers)
        session_options.inter_op_num_threads = 1
        self._session = rt.InferenceSession(
            model_path,
            sess_options=session_options,
            providers=providers,
        )
        active_providers = (
            self._session.get_providers()
            if hasattr(self._session, "get_providers")
            else getattr(self._session, "providers", ["unknown"])
        )
        self.execution_provider = active_providers[0] if active_providers else None
        logger.info(
            "Tagger inference session created active_providers=%s",
            active_providers,
        )

    @staticmethod
    def _build_result(predictions: list[TagPrediction], best_rating: TagPrediction | None) -> TaggingResult:
        if best_rating is not None:
            predictions.append(best_rating)
        rating_is_nsfw = best_rating is not None and best_rating.name in NSFW_RATING_TAGS
        is_nsfw = rating_is_nsfw or tag_names_mark_nsfw([p.name for p in predictions])
        return TaggingResult(predictions=predictions, is_nsfw=is_nsfw)

    def _predict_sync(self, image_path: str) -> TaggingResult:
        raise NotImplementedError

    async def predict(self, image_path: str) -> TaggingResult:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_executor, self._predict_sync, image_path)


class WDTagger(_OnnxTagger):
    def __init__(self):
        super().__init__()
        self._tags_df: pd.DataFrame | None = None

    def load(self):
        started_at = time.perf_counter()
        cache = str(settings.model_cache_dir)
        logger.info(
            "Tagger load started backend=%s repo=%s cache_dir=%s",
            TaggerBackendName.wd_v3.value,
            settings.tagger_model_repo,
            cache,
        )

        logger.info("Tagger download started file=model.onnx repo=%s", settings.tagger_model_repo)
        model_path = hf_hub_download(repo_id=settings.tagger_model_repo, filename="model.onnx", cache_dir=cache)
        logger.info("Tagger download finished file=model.onnx path=%s", model_path)

        logger.info("Tagger download started file=selected_tags.csv repo=%s", settings.tagger_model_repo)
        tags_path = hf_hub_download(repo_id=settings.tagger_model_repo, filename="selected_tags.csv", cache_dir=cache)
        logger.info("Tagger download finished file=selected_tags.csv path=%s", tags_path)

        self._create_session(model_path)

        logger.info("Tagger metadata load started tags_path=%s", tags_path)
        self._tags_df = pd.read_csv(tags_path)
        self._input_name = self._session.get_inputs()[0].name
        _, h, w, _ = self._session.get_inputs()[0].shape
        self._input_size = h
        logger.info(
            "Tagger load finished input_name=%s input_size=%s tag_rows=%s duration_seconds=%.2f",
            self._input_name,
            self._input_size,
            len(self._tags_df.index),
            time.perf_counter() - started_at,
        )

    def _preprocess(self, image: Image.Image) -> np.ndarray:
        if image.mode != "RGB":
            image = image.convert("RGB")
        max_dim = max(image.size)
        canvas = Image.new("RGB", (max_dim, max_dim), (255, 255, 255))
        canvas.paste(image, ((max_dim - image.width) // 2, (max_dim - image.height) // 2))
        canvas = canvas.resize((self._input_size, self._input_size), Image.BICUBIC)
        arr = np.array(canvas, dtype=np.float32)
        arr = arr[:, :, ::-1]
        return np.expand_dims(arr, 0)

    def _predict_sync(self, image_path: str) -> TaggingResult:
        image = Image.open(image_path)
        arr = self._preprocess(image)
        probs = self._session.run(None, {self._input_name: arr})[0][0]

        predictions: list[TagPrediction] = []
        best_rating: TagPrediction | None = None

        for i, prob in enumerate(probs):
            row = self._tags_df.iloc[i]
            category = int(row["category"])
            name = str(row["name"])

            if category == 9:
                rating_prediction = TagPrediction(name=name, category=category, confidence=float(prob))
                if best_rating is None or rating_prediction.confidence > best_rating.confidence:
                    best_rating = rating_prediction
                continue

            threshold = settings.tagger_threshold_character if category == 4 else settings.tagger_threshold_general
            if float(prob) >= threshold:
                predictions.append(TagPrediction(name=name, category=category, confidence=float(prob)))

        return self._build_result(predictions, best_rating)


class PixAITagger(_OnnxTagger):
    def __init__(self):
        super().__init__()
        self._input_size = 336
        self._tag_names: list[str] = []
        self._tag_categories: list[int] = []
        self._floors: np.ndarray | None = None
        self._rating_indices: list[int] = []

    def load(self):
        started_at = time.perf_counter()
        cache = str(settings.model_cache_dir)
        repo = settings.tagger_pixai_model_repo
        revision = settings.tagger_pixai_model_revision
        logger.info(
            "Tagger load started backend=%s repo=%s revision=%s cache_dir=%s",
            TaggerBackendName.pixai_v1_336_int8.value,
            repo,
            revision,
            cache,
        )
        model_path = hf_hub_download(
            repo_id=repo, filename=settings.tagger_pixai_model_file, revision=revision, cache_dir=cache
        )
        config_path = hf_hub_download(
            repo_id=repo, filename=settings.tagger_pixai_config_file, revision=revision, cache_dir=cache
        )
        self._create_session(model_path)
        with open(config_path, encoding="utf-8") as config_file:
            self._apply_config(json.load(config_file))
        model_input = self._session.get_inputs()[0]
        self._input_name = model_input.name
        self._input_size = model_input.shape[2]
        logger.info(
            "Tagger load finished input_name=%s input_size=%s tag_rows=%s duration_seconds=%.2f",
            self._input_name,
            self._input_size,
            len(self._tag_names),
            time.perf_counter() - started_at,
        )

    def _apply_config(self, config: dict) -> None:
        self._tag_names = list(config["tags"])
        category_floors = config["category_best_threshold"]
        categories: list[int] = []
        floors: list[float] = []
        rating_indices: list[int] = []
        for category, count in config["tags_split"]:
            if category == "rating":
                rating_indices.extend(range(len(categories), len(categories) + count))
            categories.extend([PIXAI_CATEGORY_IDS.get(category, -1)] * count)
            keep = category in PIXAI_CATEGORY_IDS
            floors.extend([float(category_floors[category]) if keep else np.inf] * count)
        if len(categories) != len(self._tag_names):
            raise ValueError("PixAI tag split does not match the tag list")
        self._tag_categories = categories
        self._floors = np.array(floors, dtype=np.float32)
        self._rating_indices = rating_indices

    def _preprocess(self, image: Image.Image) -> np.ndarray:
        if image.mode != "RGB":
            rgba = image.convert("RGBA")
            background = Image.new("RGBA", rgba.size, (255, 255, 255))
            background.alpha_composite(rgba)
            image = background.convert("RGB")
        size = self._input_size
        ratio = min(size / image.height, size / image.width)
        new_width, new_height = max(1, int(image.width * ratio)), max(1, int(image.height * ratio))
        resized = image.resize((new_width, new_height), Image.BILINEAR)
        top = (size - new_height) // 2
        left = (size - new_width) // 2
        arr = np.zeros((size, size, 3), dtype=np.float32)
        arr[top : top + new_height, left : left + new_width] = np.asarray(resized, dtype=np.float32)
        arr = (arr / 255.0 - 0.5) / 0.5
        return np.expand_dims(arr.transpose(2, 0, 1), 0)

    def _predict_sync(self, image_path: str) -> TaggingResult:
        with Image.open(image_path) as image:
            arr = self._preprocess(image)
        probs = self._session.run(None, {self._input_name: arr})[0][0]
        if settings.tagger_pixai_outputs_logits:
            probs = 1.0 / (1.0 + np.exp(-probs))

        predictions = [
            TagPrediction(name=self._tag_names[i], category=self._tag_categories[i], confidence=float(probs[i]))
            for i in np.flatnonzero(probs >= self._floors)
        ]
        best_rating: TagPrediction | None = None
        if self._rating_indices:
            index = max(self._rating_indices, key=lambda i: probs[i])
            best_rating = TagPrediction(
                name=PIXAI_RATING_NAMES[self._tag_names[index]], category=9, confidence=float(probs[index])
            )
        return self._build_result(predictions, best_rating)


def create_tagger(backend: str | None = None) -> _OnnxTagger:
    name = backend or settings.tagger_backend
    if name == TaggerBackendName.wd_v3.value:
        return WDTagger()
    if name == TaggerBackendName.pixai_v1_336_int8.value:
        return PixAITagger()
    raise ValueError(f"Unsupported tagger backend: {name}")


class TaggerManager:
    def __init__(self) -> None:
        self._active = create_tagger()
        self.active_name: str = settings.tagger_backend
        self.status = "loading"
        self.target: str | None = None
        self.error: str | None = None
        self._loaded = False
        self._switch_task: asyncio.Task | None = None

    @property
    def can_switch(self) -> bool:
        return self._loaded and self.status != "loading"

    def select(self, backend: str) -> None:
        self._active = create_tagger(backend)
        self.active_name = backend

    def load(self) -> None:
        self.status = "loading"
        try:
            self._active.load()
        except Exception as exc:
            self.status = "failed"
            self.error = str(exc)[:500]
            raise
        self._loaded = True
        self.status = "ready"
        self.error = None

    async def predict(self, image_path: str) -> TaggingResult:
        return await self._active.predict(image_path)

    def start_switch(self, backend: str, persist: Callable[[str], Awaitable[None]]) -> bool:
        if backend == self.active_name:
            self.status = "ready"
            self.error = None
            return False
        self.status = "loading"
        self.target = backend
        self.error = None
        self._switch_task = asyncio.create_task(self._switch(backend, persist))
        return True

    async def _switch(self, backend: str, persist: Callable[[str], Awaitable[None]]) -> None:
        try:
            candidate = create_tagger(backend)
            await asyncio.to_thread(candidate.load)
            await persist(backend)
        except asyncio.CancelledError:
            self.status = "ready"
            raise
        except Exception as exc:
            logger.exception("Tagger switch failed backend=%s", backend)
            self.status = "failed"
            self.error = str(exc)[:500]
        else:
            self._active = candidate
            self.active_name = backend
            self.status = "ready"
            logger.info("Tagger switch finished backend=%s", backend)
        finally:
            self.target = None

    async def shutdown(self) -> None:
        task = self._switch_task
        if task is None or task.done():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    def status_payload(self) -> dict:
        return {
            "active": self.active_name,
            "status": self.status,
            "target": self.target,
            "error": self.error,
            "execution_provider": self._active.execution_provider,
            "options": [{"id": name, **option} for name, option in TAGGER_OPTIONS.items()],
        }


tagger = TaggerManager()
