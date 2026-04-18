from __future__ import annotations

import io
import uuid
from pathlib import Path
from types import SimpleNamespace
from zipfile import ZipFile

import pytest
from fastapi import UploadFile
from starlette.datastructures import Headers

from backend.app.models.media import MediaType
from backend.app.utils.storage import (
    delete_file,
    delete_media_files,
    ffmpeg_available,
    poster_path,
    save_bytes,
    save_upload,
    shard_path,
    thumbnail_path,
    zip_media,
)


def test_shard_thumbnail_poster_paths_have_expected_suffixes():
    fid = uuid.uuid4()
    assert shard_path(fid, ".jpg").name.endswith(".jpg")
    assert thumbnail_path(fid).name.endswith("_thumb.webp")
    assert poster_path(fid).name.endswith("_poster.png")


@pytest.mark.asyncio
async def test_save_upload_valid_and_invalid(tmp_path):
    from backend.app import config as config_module
    old = config_module.settings.storage_dir
    config_module.settings.storage_dir = tmp_path
    try:
        upload = UploadFile(filename="x.webp", file=io.BytesIO(b"abc"), headers=Headers({"content-type": "image/webp"}))
        saved = await save_upload(upload)
        assert saved is not None
        assert saved.path.exists()

        bad = UploadFile(filename="x.bin", file=io.BytesIO(b"abc"), headers=Headers({"content-type": "application/octet-stream"}))
        assert await save_upload(bad) is None
    finally:
        config_module.settings.storage_dir = old


@pytest.mark.asyncio
async def test_save_upload_prefers_magika_detection_over_declared_mime(tmp_path):
    from backend.app import config as config_module

    old = config_module.settings.storage_dir
    config_module.settings.storage_dir = tmp_path
    try:
        upload = UploadFile(
            filename="x.jpg",
            file=io.BytesIO(b"GIF89a\x01\x00\x01\x00"),
            headers=Headers({"content-type": "image/jpeg"}),
        )

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("backend.app.utils.media_detection._detect_magika_mime_type", lambda content: "image/gif")
            saved = await save_upload(upload)

        assert saved is not None
        assert saved.path.suffix == ".gif"
        assert saved.mime_type == "image/gif"
        assert saved.media_type == MediaType.GIF
    finally:
        config_module.settings.storage_dir = old


@pytest.mark.asyncio
async def test_save_bytes_falls_back_to_declared_supported_mime(tmp_path):
    from backend.app import config as config_module

    old = config_module.settings.storage_dir
    config_module.settings.storage_dir = tmp_path
    try:
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("backend.app.utils.media_detection._detect_magika_mime_type", lambda content: "application/octet-stream")
            saved = await save_bytes(b"bitmap-ish", declared_mime_type="image/bmp", source_name="x.bin")

        assert saved is not None
        assert saved.path.suffix == ".bmp"
        assert saved.mime_type == "image/bmp"
        assert saved.media_type == MediaType.IMAGE
    finally:
        config_module.settings.storage_dir = old


@pytest.mark.asyncio
async def test_save_bytes_supports_avif_mime_and_extension(tmp_path):
    from backend.app import config as config_module

    old = config_module.settings.storage_dir
    config_module.settings.storage_dir = tmp_path
    try:
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("backend.app.utils.media_detection._detect_magika_mime_type", lambda content: None)
            saved = await save_bytes(b"avif-ish", declared_mime_type="image/avif", source_name="cover.avif")

        assert saved is not None
        assert saved.path.suffix == ".avif"
        assert saved.mime_type == "image/avif"
        assert saved.media_type == MediaType.IMAGE
    finally:
        config_module.settings.storage_dir = old


@pytest.mark.asyncio
async def test_save_bytes_normalizes_supported_aliases_to_canonical_mime(tmp_path):
    from backend.app import config as config_module

    old = config_module.settings.storage_dir
    config_module.settings.storage_dir = tmp_path
    try:
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("backend.app.utils.media_detection._detect_magika_mime_type", lambda content: None)
            saved = await save_bytes(
                b"video-ish",
                declared_mime_type="application/x-matroska",
                source_name="clip.bin",
            )

        assert saved is not None
        assert saved.path.suffix == ".mkv"
        assert saved.mime_type == "video/x-matroska"
        assert saved.media_type == MediaType.VIDEO
    finally:
        config_module.settings.storage_dir = old


@pytest.mark.asyncio
async def test_save_bytes_falls_back_to_source_extension_when_needed(tmp_path):
    from backend.app import config as config_module

    old = config_module.settings.storage_dir
    config_module.settings.storage_dir = tmp_path
    try:
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("backend.app.utils.media_detection._detect_magika_mime_type", lambda content: None)
            saved = await save_bytes(
                b"video-ish",
                declared_mime_type="application/octet-stream",
                source_name="https://example.test/media/clip.mkv?download=1",
            )

        assert saved is not None
        assert saved.path.suffix == ".mkv"
        assert saved.mime_type == "video/x-matroska"
        assert saved.media_type == MediaType.VIDEO
    finally:
        config_module.settings.storage_dir = old


@pytest.mark.asyncio
async def test_save_bytes_rejects_unsupported_when_detection_fails(tmp_path):
    from backend.app import config as config_module

    old = config_module.settings.storage_dir
    config_module.settings.storage_dir = tmp_path
    try:
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("backend.app.utils.media_detection._detect_magika_mime_type", lambda content: None)
            saved = await save_bytes(
                b"plain-text",
                declared_mime_type="application/octet-stream",
                source_name="notes.txt",
            )

        assert saved is None
    finally:
        config_module.settings.storage_dir = old


def test_delete_media_files_and_delete_file(tmp_path):
    f = tmp_path / "abc.txt"
    f.write_text("x")
    delete_media_files(str(f))
    assert not f.exists()
    tmp_path.mkdir(parents=True, exist_ok=True)

    uid = uuid.uuid4()
    media = tmp_path / f"{uid}.jpg"
    media.write_text("x")
    thumb = tmp_path / f"{uid}_thumb.webp"
    thumb.write_text("x")
    post = tmp_path / f"{uid}_poster.png"
    post.write_text("x")

    from backend.app import config as config_module
    old = config_module.settings.storage_dir
    config_module.settings.storage_dir = tmp_path
    try:
        delete_file(str(media))
        assert not media.exists()
    finally:
        config_module.settings.storage_dir = old


def test_zip_media_handles_duplicates_and_missing_files(tmp_path):
    f1 = tmp_path / "a.jpg"
    f2 = tmp_path / "b.jpg"
    f1.write_text("1")
    f2.write_text("2")
    rows = [
        SimpleNamespace(filepath=str(f1), filename="a.jpg", original_filename="dup.jpg"),
        SimpleNamespace(filepath=str(f2), filename="b.jpg", original_filename="dup.jpg"),
        SimpleNamespace(filepath=str(tmp_path / "missing.jpg"), filename="missing.jpg", original_filename="missing.jpg"),
    ]
    data = zip_media(rows)
    with ZipFile(data) as zf:
        names = sorted(zf.namelist())
    assert names == ["dup.jpg", "dup_1.jpg"]


def test_ffmpeg_available_returns_bool():
    assert isinstance(ffmpeg_available(), bool)
