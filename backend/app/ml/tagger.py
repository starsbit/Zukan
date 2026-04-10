from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
import time

import numpy as np
import pandas as pd
from huggingface_hub import hf_hub_download
from PIL import Image

from backend.app.config import settings
from backend.app.utils.tagging import NSFW_RATING_TAGS, TagPrediction, TaggingResult, tag_names_mark_nsfw

_executor = ThreadPoolExecutor(max_workers=1)
logger = logging.getLogger(__name__)


class WDTagger:
    def __init__(self):
        self._session = None
        self._tags_df: pd.DataFrame | None = None
        self._input_name: str | None = None
        self._input_size: int = 448

    def load(self):
        import onnxruntime as rt

        started_at = time.perf_counter()
        cache = str(settings.model_cache_dir)
        logger.info(
            "Tagger load started backend=%s repo=%s cache_dir=%s",
            settings.tagger_backend,
            settings.tagger_model_repo,
            cache,
        )

        logger.info("Tagger download started file=model.onnx repo=%s", settings.tagger_model_repo)
        model_path = hf_hub_download(repo_id=settings.tagger_model_repo, filename="model.onnx", cache_dir=cache)
        logger.info("Tagger download finished file=model.onnx path=%s", model_path)

        logger.info("Tagger download started file=selected_tags.csv repo=%s", settings.tagger_model_repo)
        tags_path = hf_hub_download(repo_id=settings.tagger_model_repo, filename="selected_tags.csv", cache_dir=cache)
        logger.info("Tagger download finished file=selected_tags.csv path=%s", tags_path)

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
        self._session = rt.InferenceSession(
            model_path,
            providers=providers,
        )
        active_providers = (
            self._session.get_providers()
            if hasattr(self._session, "get_providers")
            else getattr(self._session, "providers", ["unknown"])
        )
        logger.info(
            "Tagger inference session created active_providers=%s",
            active_providers,
        )

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

        if best_rating is not None:
            predictions.append(best_rating)

        rating_is_nsfw = best_rating is not None and best_rating.name in NSFW_RATING_TAGS
        is_nsfw = rating_is_nsfw or tag_names_mark_nsfw([p.name for p in predictions])
        return TaggingResult(predictions=predictions, is_nsfw=is_nsfw)

    async def predict(self, image_path: str) -> TaggingResult:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_executor, self._predict_sync, image_path)


def create_tagger() -> WDTagger:
    if settings.tagger_backend == "wd_v3":
        return WDTagger()
    raise ValueError(f"Unsupported tagger backend: {settings.tagger_backend}")


tagger = create_tagger()
