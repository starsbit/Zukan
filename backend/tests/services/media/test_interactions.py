from __future__ import annotations

import uuid

import pytest

from backend.app.errors.error import AppError
from backend.app.models.media_interactions import UserFavorite
from backend.app.services.media.interactions import MediaInteractionService


@pytest.mark.asyncio
async def test_favorite_media_adds_new_favorite_and_commits(fake_db, stub_query, media, user):
    stub_query.get_favoritable_media.return_value = media
    stub_query.get_favorite.return_value = None

    service = MediaInteractionService(fake_db, stub_query)
    await service.favorite_media(media.id, user)

    assert any(isinstance(item, UserFavorite) for item in fake_db.added)
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_unfavorite_media_raises_when_not_favorited(fake_db, stub_query, user):
    media_id = uuid.uuid4()
    stub_query.get_favorite.return_value = None

    service = MediaInteractionService(fake_db, stub_query)

    with pytest.raises(AppError) as exc:
        await service.unfavorite_media(media_id, user)

    assert exc.value.status_code == 404
    fake_db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_bulk_favorite_processes_only_active_not_already_favorited(fake_db, stub_query, user):
    m1, m2, m3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    stub_query.get_favoritable_media_ids.return_value = {m1, m2}
    stub_query.get_existing_favorites.return_value = [UserFavorite(user_id=user.id, media_id=m2)]

    service = MediaInteractionService(fake_db, stub_query)
    result = await service.bulk_favorite_media([m1, m2, m3], user)

    assert result.processed == 1
    assert result.skipped == 2
    assert [item.media_id for item in fake_db.added if isinstance(item, UserFavorite)] == [m1]
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_bulk_unfavorite_deletes_existing_favorites(fake_db, stub_query, user):
    m1, m2 = uuid.uuid4(), uuid.uuid4()
    fav1 = UserFavorite(user_id=user.id, media_id=m1)
    fav2 = UserFavorite(user_id=user.id, media_id=m2)
    stub_query.get_favoritable_media_ids.return_value = {m1, m2}
    stub_query.get_existing_favorites.return_value = [fav1, fav2]

    service = MediaInteractionService(fake_db, stub_query)
    result = await service.bulk_unfavorite_media([m1, m2, uuid.uuid4()], user)

    assert result.processed == 2
    assert result.skipped == 1
    assert fake_db.deleted == [fav1, fav2]
    fake_db.commit.assert_awaited_once()
