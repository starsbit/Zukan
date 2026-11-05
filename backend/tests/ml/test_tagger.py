from __future__ import annotations

import asyncio
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

import numpy as np
import pandas as pd
import pytest
from PIL import Image

from backend.app.ml.tagger import PixAITagger, TaggerManager, WDTagger, create_tagger


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
        def __init__(self, model_path, sess_options, providers):
            self.model_path = model_path
            self.sess_options = sess_options
            self.providers = providers

        def get_inputs(self):
            return [_Input()]

    class _SessionOptions:
        intra_op_num_threads = None
        inter_op_num_threads = None

    fake_rt.InferenceSession = _Session
    fake_rt.SessionOptions = _SessionOptions
    fake_rt.get_available_providers = lambda: ["CPUExecutionProvider"]
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

    assert isinstance(create_tagger("pixai_v1_336_int8"), PixAITagger)

    with patch("backend.app.ml.tagger.settings.tagger_backend", "unknown"):
        with pytest.raises(ValueError):
            create_tagger()


PIXAI_CONFIG = {
    "tags": ["1girl", "low", "saber", "fate", "bkub", "highres", "rating:s", "rating:g", "rating:q", "rating:e"],
    "tags_split": [["general", 2], ["character", 1], ["copyright", 1], ["style", 1], ["meta", 1], ["rating", 4]],
    "category_best_threshold": {
        "general": 0.3,
        "character": 0.5,
        "copyright": 0.6,
        "style": 0.4,
        "meta": 0.2,
        "rating": 0.05,
    },
}


def _pixai_tagger(probabilities):
    logits = np.log(np.clip(probabilities, 1e-6, 1 - 1e-6) / (1 - np.clip(probabilities, 1e-6, 1 - 1e-6)))

    class _Session:
        def run(self, *_args, **_kwargs):
            return [np.array([logits], dtype=np.float32)]

    tagger = PixAITagger()
    tagger._apply_config(PIXAI_CONFIG)
    tagger._input_name = "pixel_values"
    tagger._input_size = 16
    tagger._session = _Session()
    return tagger


def _white_image(tmp_path):
    image_path = tmp_path / "x.png"
    Image.new("RGB", (8, 8), color="white").save(image_path)
    return str(image_path)


def test_pixai_preprocess_pads_black_and_normalizes():
    tagger = PixAITagger()
    tagger._input_size = 16

    arr = tagger._preprocess(Image.new("RGB", (32, 16), color="white"))

    assert arr.shape == (1, 3, 16, 16)
    assert arr.dtype == np.float32
    assert arr[0, :, 0, 8].tolist() == [-1.0, -1.0, -1.0]
    assert arr[0, :, 8, 8].tolist() == [1.0, 1.0, 1.0]


def test_pixai_preprocess_composites_transparency_on_white():
    tagger = PixAITagger()
    tagger._input_size = 8

    arr = tagger._preprocess(Image.new("RGBA", (8, 8), color=(0, 0, 0, 0)))

    assert arr[0, :, 4, 4].tolist() == [1.0, 1.0, 1.0]


def test_pixai_preprocess_handles_extreme_aspect_ratio():
    tagger = PixAITagger()
    tagger._input_size = 16

    assert tagger._preprocess(Image.new("RGB", (5000, 1), color="white")).shape == (1, 3, 16, 16)


def test_pixai_maps_categories_from_split_and_drops_meta(tmp_path):
    tagger = _pixai_tagger([0.9, 0.2, 0.8, 0.7, 0.5, 0.99, 0.9, 0.1, 0.1, 0.1])

    result = tagger._predict_sync(_white_image(tmp_path))

    assert {p.name: p.category for p in result.predictions} == {
        "1girl": 0,
        "saber": 4,
        "fate": 3,
        "bkub": 1,
        "sensitive": 9,
    }


def test_pixai_converts_logits_to_probabilities(tmp_path):
    tagger = _pixai_tagger([0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9, 0.1, 0.1, 0.1])

    result = tagger._predict_sync(_white_image(tmp_path))

    assert all(0.0 <= p.confidence <= 1.0 for p in result.predictions)
    assert result.predictions[0].confidence == pytest.approx(0.9, abs=1e-4)


def test_pixai_accepts_exports_that_already_output_probabilities(tmp_path):
    class _Session:
        def run(self, *_args, **_kwargs):
            return [np.array([[0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9, 0.1, 0.1, 0.1]], dtype=np.float32)]

    tagger = _pixai_tagger([0.0] * 10)
    tagger._session = _Session()

    with patch("backend.app.ml.tagger.settings.tagger_pixai_outputs_logits", False):
        result = tagger._predict_sync(_white_image(tmp_path))

    assert result.predictions[0].confidence == pytest.approx(0.9)


def test_pixai_applies_each_category_floor(tmp_path):
    tagger = _pixai_tagger([0.29, 0.31, 0.49, 0.59, 0.39, 0.0, 0.9, 0.1, 0.1, 0.1])

    result = tagger._predict_sync(_white_image(tmp_path))

    assert [p.name for p in result.predictions] == ["low", "sensitive"]


@pytest.mark.parametrize(
    ("scores", "name", "is_nsfw"),
    [
        ([0.1, 0.9, 0.1, 0.1], "general", False),
        ([0.9, 0.1, 0.1, 0.1], "sensitive", False),
        ([0.1, 0.1, 0.9, 0.1], "questionable", True),
        ([0.1, 0.1, 0.1, 0.9], "explicit", True),
    ],
)
def test_pixai_rating_maps_to_existing_names_and_flags_nsfw(tmp_path, scores, name, is_nsfw):
    tagger = _pixai_tagger([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, *scores])

    result = tagger._predict_sync(_white_image(tmp_path))

    assert [p.name for p in result.predictions] == [name]
    assert result.predictions[0].category == 9
    assert result.is_nsfw is is_nsfw


def test_pixai_rejects_config_with_mismatched_split():
    with pytest.raises(ValueError):
        PixAITagger()._apply_config({**PIXAI_CONFIG, "tags": ["only_one"]})


def test_pixai_load_downloads_pinned_revision(monkeypatch, tmp_path):
    config_path = tmp_path / "config.json"
    config_path.write_text(__import__("json").dumps(PIXAI_CONFIG))
    fake_rt = ModuleType("onnxruntime")

    class _Input:
        name = "pixel_values"
        shape = ["batch", 3, 336, 336]

    class _Session:
        providers = ["CPUExecutionProvider"]

        def __init__(self, *_args, **_kwargs):
            pass

        def get_inputs(self):
            return [_Input()]

    fake_rt.InferenceSession = _Session
    fake_rt.SessionOptions = SimpleNamespace
    fake_rt.get_available_providers = lambda: ["CPUExecutionProvider"]
    monkeypatch.setitem(__import__("sys").modules, "onnxruntime", fake_rt)
    tagger = PixAITagger()

    with patch(
        "backend.app.ml.tagger.hf_hub_download", side_effect=["/tmp/model.onnx", str(config_path)]
    ) as download:
        tagger.load()

    assert {call.kwargs["revision"] for call in download.call_args_list} == {
        "29c4dc4ade24556f69694ecbd9abdd9046363442"
    }
    assert tagger._input_size == 336
    assert tagger.execution_provider == "CPUExecutionProvider"


class _FakeBackend:
    execution_provider = "CPUExecutionProvider"

    def __init__(self, name, *, load_error=None):
        self.name = name
        self.load_error = load_error

    def load(self):
        if self.load_error:
            raise self.load_error

    async def predict(self, _image_path):
        return self.name


def _manager(backends):
    with patch("backend.app.ml.tagger.settings.tagger_backend", "wd_v3"):
        manager = TaggerManager()
    manager._active = _FakeBackend("wd_v3")
    manager.load()
    return manager, patch(
        "backend.app.ml.tagger.create_tagger", side_effect=lambda name: backends[name]
    )


@pytest.mark.asyncio
async def test_manager_switch_saves_then_swaps():
    candidate = _FakeBackend("pixai_v1_336_int8")
    manager, factory = _manager({"pixai_v1_336_int8": candidate})
    persist = AsyncMock()

    with factory:
        assert manager.start_switch("pixai_v1_336_int8", persist) is True
        assert manager.status == "loading"
        assert manager.target == "pixai_v1_336_int8"
        assert manager.can_switch is False
        assert await manager.predict("x") == "wd_v3"
        await manager._switch_task

    persist.assert_awaited_once_with("pixai_v1_336_int8")
    assert manager.active_name == "pixai_v1_336_int8"
    assert manager.status == "ready"
    assert manager.target is None
    assert await manager.predict("x") == "pixai_v1_336_int8"


@pytest.mark.asyncio
async def test_manager_keeps_old_tagger_when_load_fails():
    manager, factory = _manager({"pixai_v1_336_int8": _FakeBackend("pixai", load_error=OSError("no network"))})
    persist = AsyncMock()

    with factory:
        manager.start_switch("pixai_v1_336_int8", persist)
        await manager._switch_task

    persist.assert_not_awaited()
    assert manager.active_name == "wd_v3"
    assert manager.status == "failed"
    assert manager.error == "no network"
    assert manager.can_switch is True
    assert await manager.predict("x") == "wd_v3"


@pytest.mark.asyncio
async def test_manager_does_not_swap_when_saving_fails():
    manager, factory = _manager({"pixai_v1_336_int8": _FakeBackend("pixai")})

    with factory:
        manager.start_switch("pixai_v1_336_int8", AsyncMock(side_effect=RuntimeError("db down")))
        await manager._switch_task

    assert manager.active_name == "wd_v3"
    assert manager.status == "failed"
    assert manager.error == "db down"


@pytest.mark.asyncio
async def test_manager_switch_to_active_backend_clears_failure_without_loading():
    manager, factory = _manager({})
    manager.status = "failed"
    manager.error = "old"
    persist = AsyncMock()

    with factory:
        assert manager.start_switch("wd_v3", persist) is False

    persist.assert_not_awaited()
    assert manager.status == "ready"
    assert manager.error is None


@pytest.mark.asyncio
async def test_manager_shutdown_cancels_running_switch():
    manager, factory = _manager({"pixai_v1_336_int8": _FakeBackend("pixai")})
    release = asyncio.Event()

    async def persist(_backend):
        await release.wait()

    with factory:
        manager.start_switch("pixai_v1_336_int8", persist)
        await asyncio.sleep(0.05)
        await manager.shutdown()

    assert manager._switch_task.cancelled()
    assert manager.active_name == "wd_v3"


def test_manager_cannot_switch_before_first_load():
    with patch("backend.app.ml.tagger.settings.tagger_backend", "wd_v3"):
        manager = TaggerManager()

    assert manager.can_switch is False


def test_manager_records_startup_load_failure():
    with patch("backend.app.ml.tagger.settings.tagger_backend", "wd_v3"):
        manager = TaggerManager()
    manager._active = _FakeBackend("wd_v3", load_error=OSError("offline"))

    with pytest.raises(OSError):
        manager.load()

    assert manager.status == "failed"
    assert manager.can_switch is False
