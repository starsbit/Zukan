import asyncio
from pathlib import Path
from unittest.mock import Mock

import uuid
import numpy as np
import pandas as pd
from PIL import Image

from backend.app.services import tagger as tagger_module
from backend.app.services.tagger import NSFW_HINT_TAGS, NSFW_RATING_TAGS, TagPrediction, TaggingResult


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


def test_nsfw_hint_tags_include_direct_nsfw_terms():
    assert "nsfw" in NSFW_HINT_TAGS
    assert "nude" in NSFW_HINT_TAGS


def test_preprocess_converts_to_expected_shape_and_rgb():
    wd = tagger_module.WDTagger()
    wd._input_size = 32

    image = Image.new("RGBA", (20, 10), color=(255, 0, 0, 128))
    arr = wd._preprocess(image)

    assert arr.shape == (1, 32, 32, 3)
    assert arr.dtype == np.float32


def test_derive_character_name_uses_highest_confidence_character():
    predictions = [
        TagPrediction(name="sky", category=0, confidence=0.88),
        TagPrediction(name="heroine_a", category=4, confidence=0.76),
        TagPrediction(name="heroine_b", category=4, confidence=0.92),
    ]

    assert tagger_module.derive_character_name(predictions) == "heroine_b"


def test_derive_character_name_returns_none_without_character_predictions():
    predictions = [
        TagPrediction(name="sky", category=0, confidence=0.88),
        TagPrediction(name="rating:general", category=9, confidence=0.99),
    ]

    assert tagger_module.derive_character_name(predictions) is None


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

    result = wd._predict_sync(str(image_path))

    assert result.is_nsfw is True
    assert result.character_name == "hero"
    assert [item.name for item in result.predictions] == ["hero", "forest", "rating:questionable"]


def test_predict_sync_keeps_multiple_character_predictions_above_threshold(tmp_path, monkeypatch):
    wd = tagger_module.WDTagger()
    wd._input_name = "input"
    wd._input_size = 8
    wd._tags_df = pd.DataFrame(
        [
            {"name": "heroine_a", "category": 4},
            {"name": "heroine_b", "category": 4},
            {"name": "landscape", "category": 0},
            {"name": "rating:general", "category": 9},
        ]
    )
    wd._session = Mock()
    wd._session.run.return_value = [np.array([[0.91, 0.87, 0.8, 0.99]], dtype=np.float32)]

    monkeypatch.setattr(tagger_module.settings, "tagger_threshold_character", 0.85)
    monkeypatch.setattr(tagger_module.settings, "tagger_threshold_general", 0.75)

    image_path = tmp_path / "characters.png"
    Image.new("RGB", (16, 12), color=(0, 0, 255)).save(image_path)

    result = wd._predict_sync(str(image_path))

    assert result.is_nsfw is False
    assert result.character_name == "heroine_a"
    assert [item.name for item in result.predictions] == ["heroine_a", "heroine_b", "landscape", "rating:general"]


def test_predict_sync_does_not_mark_general_rated_image_as_nsfw_when_other_ratings_are_lower(tmp_path, monkeypatch):
    wd = tagger_module.WDTagger()
    wd._input_name = "input"
    wd._input_size = 8
    wd._tags_df = pd.DataFrame(
        [
            {"name": "rating:general", "category": 9},
            {"name": "rating:questionable", "category": 9},
            {"name": "rating:explicit", "category": 9},
            {"name": "landscape", "category": 0},
        ]
    )
    wd._session = Mock()
    wd._session.run.return_value = [np.array([[0.97, 0.12, 0.03, 0.91]], dtype=np.float32)]

    monkeypatch.setattr(tagger_module.settings, "tagger_threshold_general", 0.75)

    image_path = tmp_path / "general-safe.png"
    Image.new("RGB", (16, 12), color=(0, 128, 255)).save(image_path)

    result = wd._predict_sync(str(image_path))

    assert result.is_nsfw is False
    assert [item.name for item in result.predictions] == ["landscape", "rating:general"]


def test_predict_sync_marks_direct_nsfw_tags_as_nsfw_even_without_rating_tags(tmp_path, monkeypatch):
    wd = tagger_module.WDTagger()
    wd._input_name = "input"
    wd._input_size = 8
    wd._tags_df = pd.DataFrame(
        [
            {"name": "nsfw", "category": 0},
            {"name": "rating:general", "category": 9},
            {"name": "hero", "category": 4},
        ]
    )
    wd._session = Mock()
    wd._session.run.return_value = [np.array([[0.96, 0.99, 0.8]], dtype=np.float32)]

    monkeypatch.setattr(tagger_module.settings, "tagger_threshold_character", 0.6)
    monkeypatch.setattr(tagger_module.settings, "tagger_threshold_general", 0.75)

    image_path = tmp_path / "nsfw.png"
    Image.new("RGB", (16, 12), color=(255, 0, 0)).save(image_path)

    result = wd._predict_sync(str(image_path))

    assert result.is_nsfw is True
    assert [item.name for item in result.predictions] == ["nsfw", "hero", "rating:general"]


def test_predict_uses_executor(monkeypatch):
    wd = tagger_module.WDTagger()
    monkeypatch.setattr(
        wd,
        "_predict_sync",
        lambda path: TaggingResult(
            predictions=[TagPrediction(name="sky", category=0, confidence=0.9)],
            character_name=None,
            is_nsfw=False,
        ),
    )

    result = asyncio.run(wd.predict("image.png"))

    assert result == TaggingResult(
        predictions=[TagPrediction(name="sky", category=0, confidence=0.9)],
        character_name=None,
        is_nsfw=False,
    )


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


def test_create_tagger_returns_wd_backend(monkeypatch):
    monkeypatch.setattr(tagger_module.settings, "tagger_backend", "wd_v3")

    created = tagger_module.create_tagger()

    assert isinstance(created, tagger_module.WDTagger)


def test_create_tagger_rejects_unknown_backend(monkeypatch):
    monkeypatch.setattr(tagger_module.settings, "tagger_backend", "unknown")

    try:
        tagger_module.create_tagger()
    except ValueError as exc:
        assert str(exc) == "Unsupported tagger backend: unknown"
    else:
        raise AssertionError("Expected ValueError for unsupported tagger backend")

def test_retag_returns_409_when_already_pending(api):
    user = api.register_and_login("retag-queued-user")
    headers = api.auth_headers(user["access_token"])

    blue = api.upload_media(user["access_token"], "retag-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    first = api.client.post(f"/media/{blue['id']}/tagging-jobs", headers=headers)
    assert first.status_code == 202

    second = api.client.post(f"/media/{blue['id']}/tagging-jobs", headers=headers)
    assert second.status_code == 409
    assert second.json()["code"] == "tagging_job_already_queued"


def test_retag_allowed_after_failure(api):
    user = api.register_and_login("retag-failed-user")
    headers = api.auth_headers(user["access_token"])
    blue_id_str = None

    blue = api.upload_media(user["access_token"], "retag-fail-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))
    blue_id = uuid.UUID(str(blue["id"]))
    blue_id_str = str(blue["id"])

    async def _set_failed(session):
        from backend.app.models import Media
        media = await session.get(Media, blue_id)
        media.tagging_status = "failed"
        await session.commit()

    api.run_db(_set_failed)

    retry = api.client.post(f"/media/{blue_id_str}/tagging-jobs", headers=headers)
    assert retry.status_code == 202

