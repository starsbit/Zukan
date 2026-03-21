from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
import pandas as pd
from huggingface_hub import hf_hub_download
from PIL import Image

from backend.config import settings

NSFW_RATING_TAGS = {"rating:questionable", "rating:explicit"}

_executor = ThreadPoolExecutor(max_workers=1)


@dataclass(frozen=True)
class TagPrediction:
    name: str
    category: int
    confidence: float


@dataclass(frozen=True)
class TaggingResult:
    predictions: list[TagPrediction]
    character_name: str | None
    is_nsfw: bool


class TaggerBackend(Protocol):
    def load(self) -> None: ...
    async def predict(self, image_path: str) -> TaggingResult: ...


def derive_character_name(predictions: list[TagPrediction]) -> str | None:
    character_predictions = [prediction for prediction in predictions if prediction.category == 4]
    if not character_predictions:
        return None
    return max(character_predictions, key=lambda prediction: prediction.confidence).name


class WDTagger:
    def __init__(self):
        self._session = None
        self._tags_df: pd.DataFrame | None = None
        self._input_name: str | None = None
        self._input_size: int = 448

    def load(self):
        import onnxruntime as rt

        cache = str(settings.model_cache_dir)
        model_path = hf_hub_download(repo_id=settings.tagger_model_repo, filename="model.onnx", cache_dir=cache)
        tags_path = hf_hub_download(repo_id=settings.tagger_model_repo, filename="selected_tags.csv", cache_dir=cache)

        self._session = rt.InferenceSession(
            model_path,
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        self._tags_df = pd.read_csv(tags_path)
        self._input_name = self._session.get_inputs()[0].name
        _, h, w, _ = self._session.get_inputs()[0].shape
        self._input_size = h

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
        best_rating: tuple[str, float] = ("rating:general", 0.0)

        for i, prob in enumerate(probs):
            row = self._tags_df.iloc[i]
            category = int(row["category"])
            name = str(row["name"])

            if category == 9:
                if float(prob) > best_rating[1]:
                    best_rating = (name, float(prob))
                predictions.append(TagPrediction(name=name, category=category, confidence=float(prob)))
                continue

            threshold = settings.tagger_threshold_character if category == 4 else settings.tagger_threshold_general
            if float(prob) >= threshold:
                predictions.append(TagPrediction(name=name, category=category, confidence=float(prob)))

        is_nsfw = best_rating[0] in NSFW_RATING_TAGS
        return TaggingResult(
            predictions=predictions,
            character_name=derive_character_name(predictions),
            is_nsfw=is_nsfw,
        )

    async def predict(self, image_path: str) -> TaggingResult:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_executor, self._predict_sync, image_path)


def create_tagger() -> TaggerBackend:
    if settings.tagger_backend == "wd_v3":
        return WDTagger()
    raise ValueError(f"Unsupported tagger backend: {settings.tagger_backend}")


tagger = create_tagger()
