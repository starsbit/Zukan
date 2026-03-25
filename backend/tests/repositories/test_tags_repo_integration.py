from __future__ import annotations

import pytest
from sqlalchemy import select

from backend.app.models.tags import MediaTag, Tag
from backend.app.repositories.tags import TagRepository


@pytest.mark.asyncio
async def test_tag_repository_basic_queries(db_session):
    t1 = Tag(name="safe", category=0, media_count=1)
    t2 = Tag(name="nsfw", category=9, media_count=1)
    db_session.add_all([t1, t2])
    await db_session.flush()

    repo = TagRepository(db_session)
    assert (await repo.get_by_id(t1.id)).name == "safe"
    assert (await repo.get_by_name("nsfw")).id == t2.id
    by_names = await repo.get_by_names(["safe", "nsfw", "missing"])
    assert set(by_names.keys()) == {"safe", "nsfw"}

    base_stmt = select(Tag)
    assert await repo.count(base_stmt) == 2
    listed = await repo.list(base_stmt=base_stmt, order_expr=Tag.name.asc(), offset=0, limit=10)
    assert [t.name for t in listed] == ["nsfw", "safe"]


@pytest.mark.asyncio
async def test_set_media_tag_links_insert_update_delete(db_session, make_user, make_media):
    user = await make_user()
    media = await make_media(uploader_id=user.id)

    repo = TagRepository(db_session)
    await repo.set_media_tag_links(media, [("safe", 0, 0.7), ("safe", 0, 0.9), ("artist_x", 1, 0.8)])
    await db_session.flush()

    media_tags = await repo.get_media_tags_with_tag(media.id)
    assert {mt.tag.name for mt in media_tags} == {"safe", "artist_x"}

    await repo.set_media_tag_links(media, [("safe", 1, 0.95)])
    await db_session.flush()

    media_tags2 = await repo.get_media_tags_with_tag(media.id)
    assert [mt.tag.name for mt in media_tags2] == ["safe"]
    assert media_tags2[0].confidence == 0.95
    assert media_tags2[0].tag.category == 1
