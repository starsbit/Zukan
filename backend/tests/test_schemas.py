import uuid
from datetime import datetime, timezone

from backend.app.schemas import MediaDetail, MediaRead


def _base_media_data(**overrides):
    now = datetime.now(timezone.utc)
    data = dict(
        id=uuid.uuid4(),
        uploader_id=uuid.uuid4(),
        filename="test.jpg",
        original_filename="test.jpg",
        metadata={
            "file_size": 1000,
            "width": 100,
            "height": 100,
            "mime_type": "image/jpeg",
            "captured_at": now,
        },
        tags=[],
        character_name=None,
        is_nsfw=False,
        tagging_status="done",
        thumbnail_status="done",
        created_at=now,
        deleted_at=None,
    )
    data.update(overrides)
    return data


def test_image_read_deleted_at_none():
    m = MediaRead(**_base_media_data())
    assert m.deleted_at is None


def test_image_read_deleted_at_datetime():
    now = datetime.now(timezone.utc)
    m = MediaRead(**_base_media_data(deleted_at=now))
    assert m.deleted_at == now


def test_image_read_uploader_id_nullable():
    m = MediaRead(**_base_media_data(uploader_id=None))
    assert m.uploader_id is None


def test_image_read_tags_list():
    m = MediaRead(**_base_media_data(tags=["1girl", "solo"]))
    assert m.tags == ["1girl", "solo"]


def test_image_read_metadata_nested():
    m = MediaRead(**_base_media_data())
    assert m.metadata.captured_at
    assert m.metadata.mime_type == "image/jpeg"


def test_image_read_character_name_nullable():
    m = MediaRead(**_base_media_data(character_name="ayanami_rei"))
    assert m.character_name == "ayanami_rei"


def test_image_detail_inherits_deleted_at():
    now = datetime.now(timezone.utc)
    m = MediaDetail(**_base_media_data(deleted_at=now), tag_details=[])
    assert m.deleted_at == now


def test_image_detail_tag_details_default_empty():
    m = MediaDetail(**_base_media_data())
    assert m.tag_details == []


def test_image_read_nsfw_flag():
    m = MediaRead(**_base_media_data(is_nsfw=True))
    assert m.is_nsfw is True


def test_image_read_tagging_status_values():
    for s in ("pending", "processing", "done", "failed"):
        m = MediaRead(**_base_media_data(tagging_status=s))
        assert m.tagging_status == s


def test_image_read_tagging_error_defaults_none():
    m = MediaRead(**_base_media_data())
    assert m.tagging_error is None


def test_image_read_tagging_error_can_be_set():
    m = MediaRead(**_base_media_data(tagging_error="RuntimeError: model offline"))
    assert m.tagging_error == "RuntimeError: model offline"


def test_image_read_is_favorited_defaults_false():
    m = MediaRead(**_base_media_data())
    assert m.is_favorited is False


def test_image_read_is_favorited_can_be_set():
    m = MediaRead(**_base_media_data(is_favorited=True))
    assert m.is_favorited is True


def test_image_read_model_copy_sets_is_favorited():
    m = MediaRead(**_base_media_data())
    assert m.is_favorited is False
    enriched = m.model_copy(update={"is_favorited": True})
    assert enriched.is_favorited is True
    assert m.is_favorited is False


def test_image_detail_inherits_is_favorited():
    m = MediaDetail(**_base_media_data(is_favorited=True), tag_details=[])
    assert m.is_favorited is True
