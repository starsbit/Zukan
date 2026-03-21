import asyncio
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pandas as pd
from PIL import Image

from app.services import tagger as tagger_module
from app.services.tagger import NSFW_RATING_TAGS


def test_questionable_is_nsfw():
    assert "rating:questionable" in NSFW_RATING_TAGS


def test_explicit_is_nsfw():
    assert "rating:explicit" in NSFW_RATING_TAGS


def test_general_is_not_nsfw():
    assert "rating:general" not in NSFW_RATING_TAGS


def test_sensitive_is_not_nsfw():
    assert "rating:sensitive" not in NSFW_RATING_TAGS


def test_nsfw_set_size():
    assert len(NSFW_RATING_TAGS) == 2


def test_preprocess_converts_to_expected_shape_and_rgb():
    wd = tagger_module.WDTagger()
    wd._input_size = 32

    image = Image.new("RGBA", (20, 10), color=(255, 0, 0, 128))
    arr = wd._preprocess(image)

    assert arr.shape == (1, 32, 32, 3)
    assert arr.dtype == np.float32


def test_predict_sync_filters_by_thresholds_and_marks_nsfw(tmp_path, monkeypatch):
    wd = tagger_module.WDTagger()
    wd._input_name = "input"
    wd._input_size = 8
    wd._tags_df = pd.DataFrame(
        [
            {"name": "rating:general", "category": 9},
            {"name": "rating:questionable", "category": 9},
            {"name": "hero", "category": 4},
            {"name": "forest", "category": 0},
        ]
    )
    wd._session = Mock()
    wd._session.run.return_value = [np.array([[0.2, 0.95, 0.7, 0.8]], dtype=np.float32)]

    monkeypatch.setattr(tagger_module.settings, "tagger_threshold_character", 0.6)
    monkeypatch.setattr(tagger_module.settings, "tagger_threshold_general", 0.75)

    image_path = tmp_path / "predict.png"
    Image.new("RGB", (16, 12), color=(0, 255, 0)).save(image_path)

    results, is_nsfw = wd._predict_sync(str(image_path))

    assert is_nsfw is True
    assert [item["name"] for item in results] == ["rating:general", "rating:questionable", "hero", "forest"]


def test_predict_uses_executor(monkeypatch):
    wd = tagger_module.WDTagger()
    monkeypatch.setattr(wd, "_predict_sync", lambda path: ([{"name": "sky"}], False))

    results, is_nsfw = asyncio.run(wd.predict("image.png"))

    assert results == [{"name": "sky"}]
    assert is_nsfw is False


def test_load_populates_session_and_input_details(monkeypatch, tmp_path):
    class DummyInput:
        name = "input_tensor"
        shape = [1, 448, 448, 3]

    class DummySession:
        def __init__(self, model_path, providers):
            self.model_path = model_path
            self.providers = providers

        def get_inputs(self):
            return [DummyInput()]

    dummy_rt = type("RtModule", (), {"InferenceSession": DummySession})
    monkeypatch.setattr(
        tagger_module,
        "hf_hub_download",
        lambda repo_id, filename, cache_dir: str(Path(cache_dir) / filename),
    )
    monkeypatch.setattr(
        pd,
        "read_csv",
        lambda path: pd.DataFrame([{"name": "sky", "category": 0}]),
    )
    monkeypatch.setattr(tagger_module.settings, "model_cache_dir", tmp_path)
    monkeypatch.setattr(tagger_module.settings, "tagger_model_repo", "demo/repo")
    monkeypatch.setitem(__import__("sys").modules, "onnxruntime", dummy_rt)

    wd = tagger_module.WDTagger()
    wd.load()

    assert wd._input_name == "input_tensor"
    assert wd._input_size == 448
    assert isinstance(wd._tags_df, pd.DataFrame)
