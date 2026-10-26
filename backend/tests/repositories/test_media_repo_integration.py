from __future__ import annotations
from datetime import datetime, timedelta, timezone
import pytest
from backend.app.models.media import ProcessingStatus, TaggingStatus
from backend.app.repositories.media import MediaRepository

@pytest.mark.asyncio
async def test_media_repository_delete_flushes(db_session, make_user, make_media):
    user = await make_user()
    media = await make_media()
    repo = MediaRepository(db_session)
    await repo.delete(media)
    await db_session.flush()
    assert await repo.get_by_id(media.id) is None
