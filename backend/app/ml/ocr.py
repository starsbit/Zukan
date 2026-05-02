from __future__ import annotations

import asyncio
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageOps

from backend.app.config import settings
from backend.app.models.media import MediaType
from backend.app.utils.frame_sampling import cleanup_sampled_frames, sample_media_frames

_executor = ThreadPoolExecutor(max_workers=settings.ocr_executor_workers)
_whitespace_re = re.compile(r"\s+")
logger = logging.getLogger(__name__)


class TesseractOCR:
    def __init__(self) -> None:
        self._pytesseract = None

    def load(self) -> None:
        try:
            import pytesseract  # type: ignore

            # Verify both Python wrapper and system binary are callable.
            pytesseract.get_tesseract_version()
            self._pytesseract = pytesseract
            logger.info("OCR backend initialized with Tesseract")
        except Exception:
            self._pytesseract = None
            logger.warning("OCR backend unavailable; pytesseract import or tesseract binary check failed", exc_info=True)

    def _extract_text_sync(self, image_path: str) -> str | None:
        if self._pytesseract is None:
            return None

        with Image.open(image_path) as image:
            variants = _prepare_ocr_variants(image)

            best_text = ""
            for variant in variants:
                raw_text = self._pytesseract.image_to_string(
                    variant,
                    lang=settings.ocr_languages,
                    config=settings.ocr_tesseract_config,
                    timeout=settings.ocr_timeout_seconds,
                )
                cleaned = _normalize_ocr_text(raw_text)
                if cleaned and len(cleaned) > len(best_text):
                    best_text = cleaned

            if not best_text:
                return None
            return best_text[: settings.ocr_max_chars]

    async def extract_text(self, media_path: str, media_type: MediaType) -> str | None:
        if not settings.ocr_enabled:
            logger.debug("OCR skipped because OCR_ENABLED is false")
            return None
        if self._pytesseract is None:
            logger.debug("OCR skipped because backend is not initialized")
            return None

        loop = asyncio.get_running_loop()
        source_path = Path(media_path)
        frames = sample_media_frames(media_path, media_type, sample_count=settings.ocr_sample_frames)
        frame_paths = frames or [source_path]

        try:
            texts = await asyncio.gather(
                *[loop.run_in_executor(_executor, self._extract_text_sync, str(fp)) for fp in frame_paths]
            )
            extracted = [t for t in texts if t]
            return _merge_ocr_chunks(extracted)
        finally:
            cleanup_sampled_frames([frame for frame in frames if frame != source_path])


def _normalize_ocr_text(text: str | None) -> str:
    if not text:
        return ""
    return _whitespace_re.sub(" ", text).strip()


def _merge_ocr_chunks(chunks: list[str]) -> str | None:
    if not chunks:
        return None
    merged: list[str] = []
    seen: set[str] = set()
    for chunk in chunks:
        normalized = _normalize_ocr_text(chunk)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        merged.append(normalized)
    if not merged:
        return None
    return "\n".join(merged)[: settings.ocr_max_chars]


def _prepare_ocr_variants(image: Image.Image) -> list[Image.Image]:
    grayscale = image.convert("L")
    max_dimension = max(1, settings.ocr_max_image_dimension)
    width, height = grayscale.size
    if max(width, height) > max_dimension:
        scale = max_dimension / max(width, height)
        grayscale = grayscale.resize(
            (max(1, round(width * scale)), max(1, round(height * scale))),
            Image.Resampling.LANCZOS,
        )

    variants = [grayscale]
    if settings.ocr_autocontrast_variant_enabled:
        variants.append(ImageOps.autocontrast(grayscale))
    return variants


def create_ocr_backend() -> TesseractOCR:
    return TesseractOCR()


ocr_backend = create_ocr_backend()
