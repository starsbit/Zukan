from __future__ import annotations
import pytest
from backend.app.models.media_interactions import UserFavorite
from backend.app.repositories.media_interactions import UserFavoriteRepository

@pytest.mark.asyncio
async def test_user_favorite_repository_queries(db_session, make_user, make_media):
    user = await make_user()
    m1 = await make_media()
    m2 = await make_media()
    db_session.add(UserFavorite(media_id=m1.id))
    await db_session.flush()
    repo = UserFavoriteRepository(db_session)
    assert (await repo.get_favorite(m1.id)).media_id == m1.id
    assert await repo.get_favorite(m2.id) is None
    assert await repo.get_favorited_ids([m1.id, m2.id]) == {m1.id}
    assert await repo.get_favorited_ids([]) == set()
    favorites = await repo.get_by_user_and_media_ids([m1.id, m2.id])
    assert [f.media_id for f in favorites] == [m1.id]
