from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
from pathlib import Path

import numpy as np
from PIL import Image

from backend.app.config import settings
from backend.app.models.media import MediaType
from backend.app.utils.frame_sampling import cleanup_sampled_frames, sample_media_frames

EMBEDDING_DIMENSIONS = 96
EMBEDDING_MODEL_VERSION = "color_histogram_v1"
_executor = ThreadPoolExecutor(max_workers=settings.embedding_executor_workers)
logger = logging.getLogger(__name__)


class EmbeddingBackend:
    def load(self) -> None: ...

    async def compute(self, filepath: str, media_type: MediaType) -> list[float]: ...


class ColorHistogramEmbeddingBackend:
    def load(self) -> None:
        logger.info("Embedding backend ready backend=%s model_version=%s", settings.embedding_backend, EMBEDDING_MODEL_VERSION)

    async def compute(self, filepath: str, media_type: MediaType) -> list[float]:
        frames = sample_media_frames(filepath, media_type)
        frame_paths = frames or [Path(filepath)]
        loop = asyncio.get_running_loop()
        try:
            embeddings = await asyncio.gather(*[
                loop.run_in_executor(_executor, self._compute_frame_sync, str(frame_path))
                for frame_path in frame_paths
            ])
        finally:
            cleanup_sampled_frames([frame for frame in frames if frame != Path(filepath)])

        vectors = [np.array(embedding, dtype=np.float32) for embedding in embeddings if embedding]
        if not vectors:
            return []
        average = np.mean(vectors, axis=0)
        norm = float(np.linalg.norm(average))
        if norm <= 0:
            return []
        return (average / norm).astype(np.float32).tolist()

    def _compute_frame_sync(self, filepath: str) -> list[float]:
        with Image.open(filepath) as image:
            rgb = image.convert("RGB").resize((160, 160), Image.BICUBIC)
            arr = np.asarray(rgb, dtype=np.uint8)

        parts: list[np.ndarray] = []
        for channel in range(3):
            histogram, _ = np.histogram(arr[:, :, channel], bins=32, range=(0, 256))
            parts.append(histogram.astype(np.float32))

        embedding = np.concatenate(parts)
        norm = float(np.linalg.norm(embedding))
        if norm <= 0:
            return []
        normalized = embedding / norm
        return normalized.astype(np.float32).tolist()


def create_embedding_backend() -> EmbeddingBackend:
    if settings.embedding_backend == "color_histogram_v1":
        return ColorHistogramEmbeddingBackend()
    raise ValueError(f"Unsupported embedding backend: {settings.embedding_backend}")


embedding_backend = create_embedding_backend()
