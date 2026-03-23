import uuid

import pytest

def test_tagging_status_enum_values():
    from backend.app.models import TaggingStatus
    assert TaggingStatus.PENDING == "pending"
    assert TaggingStatus.PROCESSING == "processing"
    assert TaggingStatus.DONE == "done"
    assert TaggingStatus.FAILED == "failed"


def test_processing_status_enum_values():
    from backend.app.models import ProcessingStatus
    assert ProcessingStatus.PENDING == "pending"
    assert ProcessingStatus.PROCESSING == "processing"
    assert ProcessingStatus.DONE == "done"
    assert ProcessingStatus.FAILED == "failed"
    assert ProcessingStatus.NOT_APPLICABLE == "not_applicable"


def test_media_read_rejects_invalid_tagging_status():
    from datetime import datetime, timezone
    from pydantic import ValidationError
    from backend.app.schemas import MediaRead

    now = datetime.now(timezone.utc)
    with pytest.raises(ValidationError):
        MediaRead(
            id=uuid.uuid4(),
            uploader_id=uuid.uuid4(),
            filename="x.jpg",
            original_filename="x.jpg",
            metadata={"file_size": 1, "width": 1, "height": 1, "mime_type": "image/jpeg", "captured_at": now},
            tags=[],
            is_nsfw=False,
            tagging_status="unknown_status",
            thumbnail_status="done",
            version=1,
            created_at=now,
            deleted_at=None,
        )