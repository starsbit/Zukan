from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.app.models.media import TaggingStatus
from backend.app.repositories.media import MediaRepository


@pytest.mark.asyncio
async def test_media_repository_core_queries(db_session, make_user, make_media):
    u1 = await make_user(username="u1", email="u1@example.com")
    u2 = await make_user(username="u2", email="u2@example.com")

    m1 = await make_media(uploader_id=u1.id, sha256="1" * 64, phash="ph1", file_size=10, tagging_status=TaggingStatus.PENDING)
    m2 = await make_media(uploader_id=u1.id, deleted=True, sha256="2" * 64, phash="ph1", file_size=20, tagging_status=TaggingStatus.FAILED)
    m3 = await make_media(uploader_id=u2.id, sha256="3" * 64, file_size=30, tagging_status=TaggingStatus.DONE)

    repo = MediaRepository(db_session)

    assert (await repo.get_by_id(m1.id)).id == m1.id
    assert (await repo.get_by_sha256("1" * 64)).id == m1.id
    assert len(await repo.get_by_ids([m1.id, m2.id])) == 2

    active_ids = await repo.get_active_ids([m1.id, m2.id, m3.id])
    assert active_ids == {m1.id, m3.id}

    cutoff = datetime.now(timezone.utc) + timedelta(days=1)
    expired = await repo.get_expired_trash(cutoff)
    assert {m.id for m in expired} == {m2.id}

    assert len(await repo.get_by_uploader(u1.id)) == 2
    assert len(await repo.get_active_by_uploader(u1.id)) == 1
    assert await repo.count_by_uploader(u1.id) == 2
    assert await repo.count_active() == 2
    assert await repo.count_trashed() == 1
    assert await repo.count_by_tagging_status("pending") == 1
    assert await repo.sum_file_size() == 40
    assert await repo.sum_file_size(uploader_id=u1.id) == 30

    matches = await repo.find_by_phash("ph1")
    assert {m.id for m in matches} == {m1.id}
    matches_excluded = await repo.find_by_phash("ph1", exclude_id=m1.id)
    assert matches_excluded == []


@pytest.mark.asyncio
async def test_media_repository_delete_flushes(db_session, make_user, make_media):
    user = await make_user()
    media = await make_media(uploader_id=user.id)
    repo = MediaRepository(db_session)

    await repo.delete(media)
    await db_session.flush()

    assert await repo.get_by_id(media.id) is None
