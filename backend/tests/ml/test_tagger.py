from __future__ import annotations

from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

import numpy as np
import pandas as pd
import pytest
from PIL import Image

from backend.app.ml.tagger import WDTagger, create_tagger


def test_preprocess_output_shape_and_dtype():
    tagger = WDTagger()
    tagger._input_size = 64
    img = Image.new("RGB", (40, 20), color="white")

    arr = tagger._preprocess(img)

    assert arr.shape == (1, 64, 64, 3)
    assert arr.dtype == np.float32


def test_predict_sync_applies_thresholds_and_nsfw(tmp_path):
    image_path = tmp_path / "x.png"
    Image.new("RGB", (20, 20), color="white").save(image_path)

    tagger = WDTagger()
    tagger._input_name = "input"
    tagger._tags_df = pd.DataFrame(
        [
            {"name": "safe_tag", "category": 0},
            {"name": "Saber", "category": 4},
            {"name": "rating:explicit", "category": 9},
            {"name": "low_tag", "category": 0},
        ]
    )

    class _Session:
        def run(self, *_args, **_kwargs):
            return [np.array([[0.8, 0.9, 0.7, 0.1]], dtype=np.float32)]

    tagger._session = _Session()

    with patch("backend.app.ml.tagger.settings.tagger_threshold_general", 0.5), patch(
        "backend.app.ml.tagger.settings.tagger_threshold_character", 0.85
    ):
        result = tagger._predict_sync(str(image_path))

    names = [p.name for p in result.predictions]
    assert "safe_tag" in names
    assert "Saber" in names
    assert "rating:explicit" in names
    assert "low_tag" not in names
    assert result.is_nsfw is True


@pytest.mark.asyncio
async def test_predict_runs_in_executor(monkeypatch):
    tagger = WDTagger()
    tagger._predict_sync = lambda path: "ok"

    class _Loop:
        async def run_in_executor(self, executor, fn, arg):
            return fn(arg)

    with patch("backend.app.ml.tagger.asyncio.get_running_loop", return_value=_Loop()):
        result = await tagger.predict("/tmp/x.png")

    assert result == "ok"


def test_load_wires_session_and_input_metadata(monkeypatch):
    tagger = WDTagger()

    fake_rt = ModuleType("onnxruntime")

    class _Input:
        name = "input"
        shape = [1, 448, 448, 3]

    class _Session:
        def __init__(self, model_path, providers):
            self.model_path = model_path
            self.providers = providers

        def get_inputs(self):
            return [_Input()]

    fake_rt.InferenceSession = _Session
    monkeypatch.setitem(__import__("sys").modules, "onnxruntime", fake_rt)

    with patch("backend.app.ml.tagger.hf_hub_download", side_effect=["/tmp/model.onnx", "/tmp/tags.csv"]), patch(
        "backend.app.ml.tagger.pd.read_csv", return_value=pd.DataFrame([{"name": "x", "category": 0}])
    ):
        tagger.load()

    assert tagger._session is not None
    assert tagger._input_name == "input"
    assert tagger._input_size == 448


def test_create_tagger_backend_switch(monkeypatch):
    with patch("backend.app.ml.tagger.settings.tagger_backend", "wd_v3"):
        assert isinstance(create_tagger(), WDTagger)

    with patch("backend.app.ml.tagger.settings.tagger_backend", "unknown"):
        with pytest.raises(ValueError):
            create_tagger()
