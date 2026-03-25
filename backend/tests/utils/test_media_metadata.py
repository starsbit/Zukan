from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from backend.app.models.media import MediaType
from backend.app.utils.media_metadata import (
    _parse_media_timestamp,
    _safe_float,
    _safe_int,
    extract_media_metadata,
    probe_media,
)


def test_extract_still_and_gif_metadata(tmp_path):
    img_path = tmp_path / "x.jpg"
    Image.new("RGB", (10, 20), color="red").save(img_path)
    still = extract_media_metadata(str(img_path), MediaType.IMAGE)
    assert still.width == 10
    assert still.height == 20

    gif_path = tmp_path / "x.gif"
    im1 = Image.new("RGB", (8, 8), color="blue")
    im2 = Image.new("RGB", (8, 8), color="green")
    im1.save(gif_path, save_all=True, append_images=[im2], duration=100, loop=0)
    gif = extract_media_metadata(str(gif_path), MediaType.GIF)
    assert gif.frame_count and gif.frame_count >= 1
    assert gif.width == 8


def test_extract_video_metadata_uses_probe(tmp_path):
    vpath = tmp_path / "v.mp4"
    vpath.write_text("x")
    payload = {
        "streams": [{"codec_type": "video", "width": 1920, "height": 1080, "nb_frames": "42", "duration": "3.2"}],
        "format": {"duration": "3.2", "tags": {"creation_time": "2024-01-02T03:04:05Z"}},
    }
    with patch("backend.app.utils.media_metadata.probe_media", return_value=payload):
        meta = extract_media_metadata(str(vpath), MediaType.VIDEO)
    assert meta.width == 1920
    assert meta.height == 1080
    assert meta.frame_count == 42
    assert meta.duration_seconds == 3.2
    assert meta.captured_at is not None


def test_probe_media_success_and_parse_helpers(tmp_path):
    path = tmp_path / "x.mp4"
    path.write_text("x")
    with patch("backend.app.utils.media_metadata.ffmpeg_available", return_value=True), patch(
        "backend.app.utils.media_metadata.subprocess.run",
        return_value=SimpleNamespace(returncode=0, stdout=json.dumps({"ok": 1})),
    ):
        assert probe_media(path) == {"ok": 1}

    assert _safe_float("1.5") == 1.5
    assert _safe_float("x") is None
    assert _safe_int("2") == 2
    assert _safe_int(None) is None


def test_parse_media_timestamp_variants():
    assert _parse_media_timestamp("2024:01:02 03:04:05") is not None
    assert _parse_media_timestamp("2024-01-02T03:04:05Z") is not None
    assert _parse_media_timestamp("bad") is None
