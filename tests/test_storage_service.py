import io
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image as PILImage

from tests.api_test_support import gif_bytes, mp4_bytes

from backend.models import MediaType
from backend.services.storage import (
    ALLOWED_MIME_TYPES,
    _shard_path,
    _thumbnail_path,
    delete_file,
    extract_media_metadata,
    ffmpeg_available,
    generate_poster_and_thumbnail,
    generate_thumbnail,
    get_media_dimensions,
    sample_media_frames,
)


def test_allowed_mime_types_include_common_formats():
    assert "image/jpeg" in ALLOWED_MIME_TYPES
    assert "image/png" in ALLOWED_MIME_TYPES
    assert "image/webp" in ALLOWED_MIME_TYPES
    assert "image/gif" in ALLOWED_MIME_TYPES
    assert "video/mp4" in ALLOWED_MIME_TYPES
    assert "video/webm" in ALLOWED_MIME_TYPES
    assert "video/quicktime" in ALLOWED_MIME_TYPES


def test_allowed_mime_types_exclude_unsupported_types():
    assert "application/pdf" not in ALLOWED_MIME_TYPES
    assert "text/plain" not in ALLOWED_MIME_TYPES


def test_shard_path_uses_first_two_hex_chars(tmp_path):
    with patch("backend.services.storage.settings") as mock_settings:
        mock_settings.storage_dir = tmp_path
        file_id = uuid.UUID("abcdef12-0000-0000-0000-000000000000")
        path = _shard_path(file_id, ".jpg")
        assert path.parent.name == "ab"
        assert path.name == "abcdef1200000000000000000000000000000000.jpg" or path.name.endswith(".jpg")
        assert path.parent == tmp_path / "ab"


def test_shard_path_uses_correct_extension(tmp_path):
    with patch("backend.services.storage.settings") as mock_settings:
        mock_settings.storage_dir = tmp_path
        file_id = uuid.uuid4()
        assert _shard_path(file_id, ".png").suffix == ".png"
        assert _shard_path(file_id, ".webp").suffix == ".webp"


def test_get_media_dimensions_returns_correct_size(tmp_path):
    img = PILImage.new("RGB", (320, 240))
    path = tmp_path / "test.jpg"
    img.save(path)
    assert get_media_dimensions(str(path)) == (320, 240)


def test_get_media_dimensions_returns_none_for_invalid_file(tmp_path):
    path = tmp_path / "notanimage.jpg"
    path.write_bytes(b"not image data")
    assert get_media_dimensions(str(path)) is None


def test_get_media_dimensions_returns_none_for_missing_file():
    assert get_media_dimensions("/nonexistent/path.jpg") is None


def test_generate_thumbnail_creates_webp(tmp_path):
    with patch("backend.services.storage.settings") as mock_settings:
        mock_settings.storage_dir = tmp_path
        mock_settings.thumbnail_size = 128
        file_id = uuid.uuid4()
        source = tmp_path / file_id.hex[:2] / f"{file_id.hex}.jpg"
        source.parent.mkdir(parents=True)
        PILImage.new("RGB", (800, 600), color=(100, 150, 200)).save(source)

        thumb = generate_thumbnail(str(source))

        assert thumb is not None
        assert thumb.exists()
        assert thumb.suffix == ".webp"
        with PILImage.open(thumb) as img:
            assert img.size == (128, 128)


def test_generate_thumbnail_pads_to_square(tmp_path):
    with patch("backend.services.storage.settings") as mock_settings:
        mock_settings.storage_dir = tmp_path
        mock_settings.thumbnail_size = 64
        file_id = uuid.uuid4()
        source = tmp_path / file_id.hex[:2] / f"{file_id.hex}.png"
        source.parent.mkdir(parents=True)
        PILImage.new("RGB", (200, 100)).save(source)

        thumb = generate_thumbnail(str(source))

        assert thumb is not None
        with PILImage.open(thumb) as img:
            w, h = img.size
            assert w == h


def test_generate_thumbnail_returns_none_for_invalid_file(tmp_path):
    with patch("backend.services.storage.settings") as mock_settings:
        mock_settings.storage_dir = tmp_path
        mock_settings.thumbnail_size = 128
        file_id = uuid.uuid4()
        source = tmp_path / file_id.hex[:2] / f"{file_id.hex}.jpg"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"not an image")

        assert generate_thumbnail(str(source)) is None


def test_generate_thumbnail_handles_rgba(tmp_path):
    with patch("backend.services.storage.settings") as mock_settings:
        mock_settings.storage_dir = tmp_path
        mock_settings.thumbnail_size = 64
        file_id = uuid.uuid4()
        source = tmp_path / file_id.hex[:2] / f"{file_id.hex}.png"
        source.parent.mkdir(parents=True)
        PILImage.new("RGBA", (100, 100), color=(255, 0, 0, 128)).save(source)

        thumb = generate_thumbnail(str(source))

        assert thumb is not None
        with PILImage.open(thumb) as img:
            assert img.size == (64, 64)


def test_thumbnail_path_has_thumb_suffix(tmp_path):
    with patch("backend.services.storage.settings") as mock_settings:
        mock_settings.storage_dir = tmp_path
        file_id = uuid.UUID("abcdef12-0000-0000-0000-000000000000")
        path = _thumbnail_path(file_id)
        assert path.name.endswith("_thumb.webp")
        assert path.parent.name == "ab"


def test_thumbnail_path_same_shard_dir_as_source(tmp_path):
    with patch("backend.services.storage.settings") as mock_settings:
        mock_settings.storage_dir = tmp_path
        file_id = uuid.UUID("abcdef12-0000-0000-0000-000000000000")
        assert _shard_path(file_id, ".jpg").parent == _thumbnail_path(file_id).parent


def test_delete_file_removes_thumbnail(tmp_path):
    with patch("backend.services.storage.settings") as mock_settings:
        mock_settings.storage_dir = tmp_path
        file_id = uuid.uuid4()
        shard_dir = tmp_path / file_id.hex[:2]
        shard_dir.mkdir(parents=True)
        source = shard_dir / f"{file_id.hex}.jpg"
        PILImage.new("RGB", (100, 100)).save(source)
        thumb = shard_dir / f"{file_id.hex}_thumb.webp"
        PILImage.new("RGB", (64, 64)).save(thumb, format="WEBP")

        delete_file(str(source))

        assert not source.exists()
        assert not thumb.exists()


def test_delete_file_ok_when_no_thumbnail(tmp_path):
    with patch("backend.services.storage.settings") as mock_settings:
        mock_settings.storage_dir = tmp_path
        file_id = uuid.uuid4()
        shard_dir = tmp_path / file_id.hex[:2]
        shard_dir.mkdir(parents=True)
        source = shard_dir / f"{file_id.hex}.jpg"
        PILImage.new("RGB", (100, 100)).save(source)

        delete_file(str(source))

        assert not source.exists()


def test_extract_media_metadata_for_gif(tmp_path):
    path = tmp_path / "animated.gif"
    path.write_bytes(gif_bytes([(0, 0, 255), (0, 255, 0), (255, 0, 0)]))

    metadata = extract_media_metadata(str(path), MediaType.GIF)

    assert metadata.media_type == MediaType.GIF
    assert metadata.width == 32
    assert metadata.height == 24
    assert metadata.frame_count == 3
    assert metadata.duration_seconds is not None


@pytest.mark.skipif(not ffmpeg_available(), reason="ffmpeg not available")
def test_extract_media_metadata_for_mp4(tmp_path):
    path = tmp_path / "clip.mp4"
    path.write_bytes(mp4_bytes([(0, 0, 255), (0, 255, 0), (255, 0, 0)]))

    metadata = extract_media_metadata(str(path), MediaType.VIDEO)

    assert metadata.media_type == MediaType.VIDEO
    assert metadata.width == 32
    assert metadata.height == 24
    assert metadata.duration_seconds is not None


def test_generate_poster_and_thumbnail_for_gif(tmp_path):
    with patch("backend.services.storage.settings") as mock_settings:
        mock_settings.storage_dir = tmp_path
        mock_settings.thumbnail_size = 64
        file_id = uuid.uuid4()
        source = tmp_path / file_id.hex[:2] / f"{file_id.hex}.gif"
        source.parent.mkdir(parents=True)
        source.write_bytes(gif_bytes([(0, 0, 255), (0, 255, 0), (255, 0, 0)]))

        poster, thumb = generate_poster_and_thumbnail(str(source), MediaType.GIF)

        assert poster is not None and poster.exists()
        assert thumb is not None and thumb.exists()


@pytest.mark.skipif(not ffmpeg_available(), reason="ffmpeg not available")
def test_sample_media_frames_for_mp4(tmp_path):
    path = tmp_path / "sample.mp4"
    path.write_bytes(mp4_bytes([(0, 0, 255), (0, 255, 0), (255, 0, 0), (255, 0, 0), (0, 0, 255)]))

    frames = sample_media_frames(str(path), MediaType.VIDEO)

    assert len(frames) >= 1
    assert all(frame.exists() for frame in frames)
