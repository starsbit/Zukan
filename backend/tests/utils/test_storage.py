from __future__ import annotations

import io
import uuid
from pathlib import Path
from types import SimpleNamespace
from zipfile import ZipFile

import pytest
from fastapi import UploadFile
from starlette.datastructures import Headers

from backend.app.utils.storage import delete_file, delete_media_files, ffmpeg_available, poster_path, save_upload, shard_path, thumbnail_path, zip_media


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
