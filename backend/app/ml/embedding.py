from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import logging
from pathlib import Path
import time

from huggingface_hub import hf_hub_download
import numpy as np
from PIL import Image

from backend.app.config import settings
from backend.app.models.media import MediaType
from backend.app.utils.frame_sampling import cleanup_sampled_frames, sample_media_frames

_executor = ThreadPoolExecutor(max_workers=settings.embedding_executor_workers)
logger = logging.getLogger(__name__)

CLIP_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
CLIP_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


@dataclass(frozen=True)
class EmbeddingBackendMetadata:
    model_version: str
    dimensions: int
    repo_id: str | None = None
    filename: str | None = None


class EmbeddingBackend:
    metadata: EmbeddingBackendMetadata

    def load(self) -> None: ...

    async def compute(self, filepath: str, media_type: MediaType) -> list[float]: ...


class ColorHistogramEmbeddingBackend:
    metadata = EmbeddingBackendMetadata(model_version="color_histogram_v1", dimensions=96)

    def load(self) -> None:
        logger.info(
            "Embedding backend ready backend=%s model_version=%s dimensions=%s",
            settings.embedding_backend,
            self.metadata.model_version,
            self.metadata.dimensions,
        )

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


class CLIPOnnxEmbeddingBackend:
    metadata = EmbeddingBackendMetadata(
        model_version="clip_onnx_v1",
        dimensions=512,
        repo_id=settings.embedding_model_repo,
        filename=settings.embedding_model_file,
    )

    def __init__(self) -> None:
        self._session = None
        self._input_name: str | None = None
        self._input_size = 224

    def load(self) -> None:
        import onnxruntime as rt

        if self._session is not None:
            return

        started_at = time.perf_counter()
        cache = str(settings.model_cache_dir)
        logger.info(
            "Embedding backend load started backend=%s repo=%s file=%s cache_dir=%s",
            settings.embedding_backend,
            settings.embedding_model_repo,
            settings.embedding_model_file,
            cache,
        )
        model_path = hf_hub_download(
            repo_id=settings.embedding_model_repo,
            filename=settings.embedding_model_file,
            cache_dir=cache,
        )

        available_providers = list(rt.get_available_providers())
        preferred_providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        providers = [provider for provider in preferred_providers if provider in available_providers] or ["CPUExecutionProvider"]
        session_options = rt.SessionOptions()
        session_options.intra_op_num_threads = max(1, settings.embedding_executor_workers)
        session_options.inter_op_num_threads = 1
        self._session = rt.InferenceSession(
            model_path,
            sess_options=session_options,
            providers=providers,
        )
        model_input = self._session.get_inputs()[0]
        self._input_name = model_input.name
        shape = list(getattr(model_input, "shape", []) or [])
        size_candidates = [value for value in shape if isinstance(value, int) and value > 1]
        if size_candidates:
            self._input_size = int(size_candidates[-1])
        logger.info(
            "Embedding backend load finished backend=%s model_version=%s dimensions=%s input_name=%s input_size=%s duration_seconds=%.2f",
            settings.embedding_backend,
            self.metadata.model_version,
            self.metadata.dimensions,
            self._input_name,
            self._input_size,
            time.perf_counter() - started_at,
        )

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
        return _normalize_vector(average)

    def _compute_frame_sync(self, filepath: str) -> list[float]:
        if self._session is None or self._input_name is None:
            self.load()
        assert self._session is not None
        assert self._input_name is not None

        with Image.open(filepath) as image:
            arr = self._preprocess(image)

        outputs = self._session.run(None, {self._input_name: arr})
        vector = self._select_embedding_output(outputs)
        return _normalize_vector(vector)

    def _preprocess(self, image: Image.Image) -> np.ndarray:
        if image.mode != "RGB":
            image = image.convert("RGB")
        image = image.resize((self._input_size, self._input_size), Image.BICUBIC)
        arr = np.asarray(image, dtype=np.float32) / 255.0
        arr = (arr - CLIP_MEAN) / CLIP_STD
        arr = np.transpose(arr, (2, 0, 1))
        return np.expand_dims(arr, 0).astype(np.float32)

    def _select_embedding_output(self, outputs) -> np.ndarray:
        candidates: list[np.ndarray] = []
        for output in outputs:
            arr = np.asarray(output, dtype=np.float32)
            if arr.ndim == 2 and arr.shape[0] == 1:
                candidates.append(arr[0])
            elif arr.ndim == 1:
                candidates.append(arr)
        for candidate in candidates:
            if candidate.shape[-1] == self.metadata.dimensions:
                return candidate
        if candidates:
            return candidates[-1]
        raise ValueError("CLIP embedding model did not return a usable vector output")


def _normalize_vector(vector: np.ndarray) -> list[float]:
    norm = float(np.linalg.norm(vector))
    if norm <= 0:
        return []
    return (vector / norm).astype(np.float32).tolist()


def create_embedding_backend() -> EmbeddingBackend:
    backend_registry = {
        "clip_onnx_v1": CLIPOnnxEmbeddingBackend,
        "color_histogram_v1": ColorHistogramEmbeddingBackend,
    }
    backend_cls = backend_registry.get(settings.embedding_backend)
    if backend_cls is not None:
        return backend_cls()
    raise ValueError(f"Unsupported embedding backend: {settings.embedding_backend}")


embedding_backend = create_embedding_backend()
EMBEDDING_MODEL_VERSION = embedding_backend.metadata.model_version
EMBEDDING_DIMENSIONS = embedding_backend.metadata.dimensions
