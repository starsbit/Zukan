from __future__ import annotations

import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from PIL import Image

from backend.app.models.media import MediaType
from backend.app.utils.thumbnails import generate_poster_and_thumbnail, generate_thumbnail, get_media_dimensions


def test_generate_thumbnail_and_dimensions(tmp_path):
    fid = uuid.uuid4()
    source = tmp_path / f"{fid}.jpg"
    Image.new("RGB", (32, 16), color="red").save(source)

    from backend.app import config as config_module
    old = config_module.settings.storage_dir
    config_module.settings.storage_dir = tmp_path
    try:
        thumb = generate_thumbnail(str(source))
        dims = get_media_dimensions(str(source))
    finally:
        config_module.settings.storage_dir = old

    assert thumb is not None
    assert thumb.exists()
    assert dims == (32, 16)


def test_generate_poster_and_thumbnail_for_image_and_gif(tmp_path):
    fid = uuid.uuid4()
    source = tmp_path / f"{fid}.jpg"
    Image.new("RGB", (16, 16), color="red").save(source)

    from backend.app import config as config_module
    old = config_module.settings.storage_dir
    config_module.settings.storage_dir = tmp_path
    try:
        poster, thumb = generate_poster_and_thumbnail(str(source), MediaType.IMAGE)
    finally:
        config_module.settings.storage_dir = old

    assert poster is None
    assert thumb is not None

    gid = uuid.uuid4()
    gif = tmp_path / f"{gid}.gif"
    Image.new("RGB", (16, 16), color="blue").save(gif, save_all=True, append_images=[Image.new("RGB", (16, 16), color="green")])
    old = config_module.settings.storage_dir
    config_module.settings.storage_dir = tmp_path
    try:
        poster2, thumb2 = generate_poster_and_thumbnail(str(gif), MediaType.GIF)
    finally:
        config_module.settings.storage_dir = old

    assert poster2 is not None
    assert thumb2 is not None


def test_generate_poster_and_thumbnail_video_mocked_ffmpeg(tmp_path):
    fid = uuid.uuid4()
    vid = tmp_path / f"{fid}.mp4"
    vid.write_text("x")

    from backend.app import config as config_module
    old = config_module.settings.storage_dir
    config_module.settings.storage_dir = tmp_path

    def fake_run(cmd, capture_output, text, timeout):
        Image.new("RGB", (16, 16), color="white").save(Path(cmd[-1]), "PNG")
        return SimpleNamespace(returncode=0)

    try:
        with patch("backend.app.utils.thumbnails.ffmpeg_available", return_value=True), patch(
            "backend.app.utils.thumbnails.probe_media", return_value={"format": {"duration": "2.0"}}
        ), patch("backend.app.utils.thumbnails.subprocess.run", side_effect=fake_run):
            poster, thumb = generate_poster_and_thumbnail(str(vid), MediaType.VIDEO)
    finally:
        config_module.settings.storage_dir = old

    assert poster is not None
    assert thumb is not None


@pytest.mark.parametrize("media_type", [MediaType.IMAGE, MediaType.GIF, MediaType.VIDEO])
def test_new_nas_previews_can_be_reopened_from_stored_paths(tmp_path, monkeypatch, media_type):
    from backend.app.config import settings
    from backend.app.utils.library_paths import resolve_media_path, stored_path

    monkeypatch.setattr(settings, "storage_dir", tmp_path)
    monkeypatch.setattr(settings, "library_paths_relative", True)
    monkeypatch.setattr(settings, "generated_files_dir", ".zukan")
    source = tmp_path / f"{uuid.uuid4().hex}.gif"
    Image.new("RGB", (16, 16), "red").save(source)
    def forbidden_chmod(*args, **kwargs):
        raise AssertionError("Share ACLs must be respected")

    def fake_ffmpeg(cmd, **kwargs):
        Image.new("RGB", (16, 16), "blue").save(Path(cmd[-1]), "PNG")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(Path, "chmod", forbidden_chmod)
    monkeypatch.setattr("backend.app.utils.thumbnails.ffmpeg_available", lambda: True)
    monkeypatch.setattr("backend.app.utils.thumbnails.probe_media", lambda path: {})
    monkeypatch.setattr("backend.app.utils.thumbnails.subprocess.run", fake_ffmpeg)

    poster, thumb = generate_poster_and_thumbnail(str(source), media_type)
    assert thumb is not None
    if media_type != MediaType.IMAGE:
        assert poster is not None
    for path in (poster, thumb):
        if path is not None:
            persisted = stored_path(path)
            with Image.open(resolve_media_path(persisted)) as reopened:
                reopened.load()
