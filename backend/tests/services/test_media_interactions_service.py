from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.media_interactions import UserFavorite
from backend.app.services.media_interactions import MediaInteractionService


@pytest.mark.asyncio
async def test_set_favorite_state_adds_and_removes(fake_db):
    service = MediaInteractionService(fake_db)
    media_id = uuid.uuid4()
    user_id = uuid.uuid4()

    with patch("backend.app.services.media_interactions.UserFavoriteRepository") as repo_cls:
        repo = repo_cls.return_value
        repo.get = AsyncMock(side_effect=[None, UserFavorite(user_id=user_id, media_id=media_id)])

        added = await service.set_favorite_state(media_id, user_id, True)
        removed = await service.set_favorite_state(media_id, user_id, False)

    assert added is True
    assert removed is True
    assert isinstance(fake_db.added[0], UserFavorite)
    assert len(fake_db.deleted) == 1


@pytest.mark.asyncio
async def test_unfavorite_raises_when_missing(fake_db):
    service = MediaInteractionService(fake_db)

    with patch("backend.app.services.media_interactions.UserFavoriteRepository") as repo_cls:
        repo_cls.return_value.get = AsyncMock(return_value=None)

        with pytest.raises(AppError) as exc:
            await service.unfavorite_media(uuid.uuid4(), uuid.uuid4())

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_passthrough_and_favorite_commit_paths(fake_db):
    service = MediaInteractionService(fake_db)
    media_id = uuid.uuid4()
    user_id = uuid.uuid4()
    favorite = UserFavorite(user_id=user_id, media_id=media_id)

    with patch("backend.app.services.media_interactions.UserFavoriteRepository") as repo_cls:
        repo = repo_cls.return_value
        repo.get = AsyncMock(return_value=favorite)
        repo.get_favorited_ids = AsyncMock(return_value={media_id})

        got = await service.get_favorite(media_id, user_id)
        ids = await service.get_favorited_ids(user_id, [media_id])
        await service.favorite_media(media_id, user_id)

    assert got is favorite
    assert ids == {media_id}
    fake_db.commit.assert_awaited_once()
