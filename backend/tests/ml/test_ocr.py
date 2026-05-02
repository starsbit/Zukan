from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from backend.app.models.media import MediaType
from PIL import Image

from backend.app.ml.ocr import TesseractOCR, _merge_ocr_chunks, _normalize_ocr_text, _prepare_ocr_variants
from backend.app.config import settings


def test_normalize_and_merge_ocr_chunks():
    assert _normalize_ocr_text("  a\n\tb  ") == "a b"
    assert _normalize_ocr_text(None) == ""

    merged = _merge_ocr_chunks(["  one ", "one", "two", " "])
    assert merged == "one\ntwo"
    assert _merge_ocr_chunks([]) is None


@pytest.mark.asyncio
async def test_extract_text_short_circuits_when_disabled_or_unloaded(tmp_path):
    source = tmp_path / "img.png"
    source.write_text("x")

    ocr = TesseractOCR()
    with patch("backend.app.ml.ocr.settings.ocr_enabled", False):
        assert await ocr.extract_text(str(source), MediaType.IMAGE) is None

    with patch("backend.app.ml.ocr.settings.ocr_enabled", True):
        assert await ocr.extract_text(str(source), MediaType.IMAGE) is None


@pytest.mark.asyncio
async def test_extract_text_uses_frames_and_cleans_temp_files(tmp_path):
    source = tmp_path / "source.png"
    frame1 = tmp_path / "frame1.png"
    frame2 = tmp_path / "frame2.png"
    for p in (source, frame1, frame2):
        p.write_text("x")

    ocr = TesseractOCR()
    ocr._pytesseract = object()

    class _Loop:
        async def run_in_executor(self, executor, fn, arg):
            return fn(arg)

    calls = []

    def fake_sync(path: str):
        calls.append(Path(path).name)
        return {"frame1.png": "hello", "frame2.png": "world", "source.png": "source"}.get(Path(path).name)

    with patch("backend.app.ml.ocr.settings.ocr_enabled", True), patch(
        "backend.app.ml.ocr.asyncio.get_running_loop", return_value=_Loop()
    ), patch("backend.app.ml.ocr.sample_media_frames", return_value=[frame1, frame2]), patch(
        "backend.app.ml.ocr.cleanup_sampled_frames"
    ) as cleanup:
        ocr._extract_text_sync = fake_sync
        text = await ocr.extract_text(str(source), MediaType.VIDEO)

    assert text == "hello\nworld"
    assert calls == ["frame1.png", "frame2.png"]
    cleanup.assert_called_once_with([frame1, frame2])


def test_ocr_load_success_and_failure_paths(monkeypatch):
    ocr = TesseractOCR()

    class _PyTesseract:
        @staticmethod
        def get_tesseract_version():
            return "5.0"

    def import_ok(name, *args, **kwargs):
        if name == "pytesseract":
            return _PyTesseract
        return __import__(name, *args, **kwargs)

    with patch("builtins.__import__", side_effect=import_ok):
        ocr.load()
    assert ocr._pytesseract is _PyTesseract

    def import_fail(name, *args, **kwargs):
        if name == "pytesseract":
            raise RuntimeError("missing")
        return __import__(name, *args, **kwargs)

    with patch("builtins.__import__", side_effect=import_fail):
        ocr.load()
    assert ocr._pytesseract is None


def test_prepare_ocr_variants_downscales_and_uses_single_fast_pass_by_default(monkeypatch):
    image = Image.new("RGB", (4000, 2000), color="white")

    monkeypatch.setattr(settings, "ocr_max_image_dimension", 1000)
    monkeypatch.setattr(settings, "ocr_autocontrast_variant_enabled", False)

    variants = _prepare_ocr_variants(image)

    assert len(variants) == 1
    assert variants[0].size == (1000, 500)


def test_prepare_ocr_variants_can_include_autocontrast(monkeypatch):
    image = Image.new("RGB", (100, 50), color="white")

    monkeypatch.setattr(settings, "ocr_max_image_dimension", 1000)
    monkeypatch.setattr(settings, "ocr_autocontrast_variant_enabled", True)

    variants = _prepare_ocr_variants(image)

    assert len(variants) == 2
