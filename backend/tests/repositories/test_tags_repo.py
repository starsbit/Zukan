from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.app.models.tags import MediaTag, Tag
from backend.app.repositories.tags import TagRepository


class RecordingDb:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.execute = AsyncMock()
        self.flush = AsyncMock()
        self.delete = AsyncMock()

    def add(self, obj: object) -> None:
        self.added.append(obj)


@pytest.mark.asyncio
async def test_set_media_tag_links_retries_tag_lookup_after_insert_miss():
    owner_id = uuid.uuid4()
    media_id = uuid.uuid4()
    media = SimpleNamespace(id=media_id, owner_id=owner_id, uploader_id=owner_id)
    tag = Tag(owner_user_id=owner_id, name="incoming_gift", category=0, media_count=0)
    tag.id = 123

    db = RecordingDb()
    repo = TagRepository(db)  # type: ignore[arg-type]
    repo.get_media_tags_with_tag = AsyncMock(return_value=[])  # type: ignore[method-assign]
    repo.get_by_names = AsyncMock(  # type: ignore[method-assign]
        side_effect=[{}, {"incoming_gift": tag}]
    )
    repo.recount_tag_ids = AsyncMock()  # type: ignore[method-assign]

    await repo.set_media_tag_links(media, [("incoming_gift", 0, 0.91)])

    assert db.execute.await_count == 2
    assert len(db.added) == 1
    media_tag = db.added[0]
    assert isinstance(media_tag, MediaTag)
    assert media_tag.media_id == media_id
    assert media_tag.tag_id == 123
    repo.recount_tag_ids.assert_awaited_once_with({123})
