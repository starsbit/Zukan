from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from backend.app.models.media import MediaType
from backend.app.utils.frame_sampling import (
    _sample_indexes,
    _sample_timestamps,
    cleanup_sampled_frames,
    sample_media_frames,
)


def test_sample_indexes_and_timestamps_edge_cases():
    assert _sample_indexes(1, 5) == [0]
    assert _sample_timestamps(0, 5) == [0.0]
    assert len(_sample_timestamps(10, 3)) == 3


def test_sample_media_frames_image_and_cleanup(tmp_path):
    img = tmp_path / "a.jpg"
    Image.new("RGB", (8, 8), color="red").save(img)
    frames = sample_media_frames(str(img), MediaType.IMAGE)
    assert frames == [img]

    extra = tmp_path / "extra.png"
    extra.write_text("x")
    cleanup_sampled_frames([extra])
    assert not extra.exists()


def test_sample_media_frames_gif(tmp_path):
    gif = tmp_path / "a.gif"
    im1 = Image.new("RGB", (8, 8), color="blue")
    im2 = Image.new("RGB", (8, 8), color="green")
    im1.save(gif, save_all=True, append_images=[im2], duration=100, loop=0)
    frames = sample_media_frames(str(gif), MediaType.GIF, sample_count=2)
    assert len(frames) >= 1
    cleanup_sampled_frames(frames)


def test_sample_media_frames_video_with_mocked_ffmpeg(tmp_path):
    vid = tmp_path / "a.mp4"
    vid.write_text("x")

    def fake_run(cmd, capture_output, text):
        out = Path(cmd[-1])
        out.write_text("frame")
        return SimpleNamespace(returncode=0)

    with patch("backend.app.utils.frame_sampling.ffmpeg_available", return_value=True), patch(
        "backend.app.utils.frame_sampling.probe_media", return_value={"format": {"duration": "2.0"}}
    ), patch("backend.app.utils.frame_sampling.subprocess.run", side_effect=fake_run):
        frames = sample_media_frames(str(vid), MediaType.VIDEO, sample_count=2)
    assert len(frames) == 2
    cleanup_sampled_frames(frames)
