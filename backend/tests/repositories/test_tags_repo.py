from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.app.models.tags import MediaTag
from backend.app.repositories.tags import TagRepository


class RecordingDb:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.execute = AsyncMock()
        self.flush = AsyncMock()
        self.delete = AsyncMock()

    def add(self, obj: object) -> None:
        self.added.append(obj)


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


@pytest.mark.asyncio
async def test_set_media_tag_links_uses_upserted_tag_row():
    owner_id = uuid.uuid4()
    media_id = uuid.uuid4()
    media = SimpleNamespace(id=media_id, owner_id=owner_id, uploader_id=owner_id)
    tag_row = SimpleNamespace(id=123, name="incoming_gift", category=0)

    db = RecordingDb()
    db.execute.return_value = _Rows([tag_row])
    repo = TagRepository(db)  # type: ignore[arg-type]
    repo.get_media_tags_with_tag = AsyncMock(return_value=[])  # type: ignore[method-assign]
    repo.recount_tag_ids = AsyncMock()  # type: ignore[method-assign]

    await repo.set_media_tag_links(media, [("incoming_gift", 0, 0.91)])

    db.execute.assert_awaited_once()
    assert len(db.added) == 1
    media_tag = db.added[0]
    assert isinstance(media_tag, MediaTag)
    assert media_tag.media_id == media_id
    assert media_tag.tag_id == 123
    repo.recount_tag_ids.assert_awaited_once_with({123})
