from __future__ import annotations

import pytest

from backend.app.models.media_interactions import UserFavorite
from backend.app.repositories.media_interactions import UserFavoriteRepository


@pytest.mark.asyncio
async def test_user_favorite_repository_queries(db_session, make_user, make_media):
    user = await make_user()
    m1 = await make_media(uploader_id=user.id)
    m2 = await make_media(uploader_id=user.id)
    db_session.add(UserFavorite(user_id=user.id, media_id=m1.id))
    await db_session.flush()

    repo = UserFavoriteRepository(db_session)
    assert (await repo.get(m1.id, user.id)).media_id == m1.id
    assert await repo.get(m2.id, user.id) is None
    assert await repo.get_favorited_ids(user.id, [m1.id, m2.id]) == {m1.id}
    assert await repo.get_favorited_ids(user.id, []) == set()
    favorites = await repo.get_by_user_and_media_ids(user.id, [m1.id, m2.id])
    assert [f.media_id for f in favorites] == [m1.id]
