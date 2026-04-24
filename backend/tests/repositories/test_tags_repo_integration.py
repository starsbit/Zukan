from __future__ import annotations

import pytest
from sqlalchemy import select

from backend.app.models.media import MediaVisibility
from backend.app.models.tags import MediaTag, Tag
from backend.app.repositories.tags import TagRepository


@pytest.mark.asyncio
async def test_tag_repository_basic_queries(db_session, make_user):
    user = await make_user()
    t1 = Tag(owner_user_id=user.id, name="safe", category=0, media_count=1)
    t2 = Tag(owner_user_id=user.id, name="nsfw", category=9, media_count=1)
    db_session.add_all([t1, t2])
    await db_session.flush()

    repo = TagRepository(db_session)
    assert (await repo.get_by_id(t1.id)).name == "safe"
    assert (await repo.get_by_name(user.id, "nsfw")).id == t2.id
    by_names = await repo.get_by_names(user.id, ["safe", "nsfw", "missing"])
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
    assert media_tags2[0].tag.owner_user_id == user.id


@pytest.mark.asyncio
async def test_list_accessible_counts_use_own_and_public_media_only(db_session, make_user, make_media):
    viewer = await make_user()
    public_owner = await make_user()
    private_owner = await make_user()

    viewer_media = await make_media(uploader_id=viewer.id)
    public_media = await make_media(uploader_id=public_owner.id, visibility=MediaVisibility.public)
    private_media = await make_media(uploader_id=private_owner.id)

    repo = TagRepository(db_session)
    await repo.set_media_tag_links(viewer_media, [("shared", 0, 0.9), ("mine", 0, 0.8)])
    await repo.set_media_tag_links(public_media, [("shared", 0, 0.9)])
    await repo.set_media_tag_links(private_media, [("shared", 0, 0.9), ("private_only", 0, 0.9)])
    await db_session.flush()

    rows = await repo.list_accessible(viewer, category=None, query=None)
    by_name = {row.name: row.media_count for row in rows}

    assert by_name["shared"] == 2
    assert by_name["mine"] == 1
    assert "private_only" not in by_name

    owner_rows = await repo.list_accessible(viewer, category=None, query=None, scope="owner")
    assert {row.name: row.media_count for row in owner_rows} == {"shared": 1, "mine": 1}


@pytest.mark.asyncio
async def test_list_accessible_supports_fuzzy_tag_queries(db_session, make_user, make_media):
    viewer = await make_user()
    media = await make_media(uploader_id=viewer.id)

    repo = TagRepository(db_session)
    await repo.set_media_tag_links(media, [("white_shirt", 0, 0.9), ("nero_claudius_(fate/extra)", 0, 0.8)])
    await db_session.flush()

    middle_rows = await repo.list_accessible(viewer, category=None, query="shirt")
    separator_rows = await repo.list_accessible(viewer, category=None, query="fate extra")

    assert [row.name for row in middle_rows] == ["white_shirt"]
    assert [row.name for row in separator_rows] == ["nero_claudius_(fate/extra)"]


@pytest.mark.asyncio
async def test_list_accessible_matches_tag_query_on_token_boundaries(db_session, make_user, make_media):
    viewer = await make_user()
    aru_media = await make_media(uploader_id=viewer.id)
    koharu_media = await make_media(uploader_id=viewer.id)

    repo = TagRepository(db_session)
    await repo.set_media_tag_links(aru_media, [("Aru (Blue Archive)", 4, 0.9)])
    await repo.set_media_tag_links(koharu_media, [("Koharu (Blue Archive)", 4, 0.9)])
    await db_session.flush()

    rows = await repo.list_accessible(
        viewer,
        category=None,
        query="Aru (Blue Archive)",
        scope="owner",
    )

    assert [row.name for row in rows] == ["Aru (Blue Archive)"]


@pytest.mark.asyncio
async def test_set_media_tag_links_create_same_name_rows_per_owner(db_session, make_user, make_media):
    owner_a = await make_user()
    owner_b = await make_user()
    media_a = await make_media(uploader_id=owner_a.id)
    media_b = await make_media(uploader_id=owner_b.id)

    repo = TagRepository(db_session)
    await repo.set_media_tag_links(media_a, [("shared", 0, 0.9)])
    await repo.set_media_tag_links(media_b, [("shared", 0, 0.8)])
    await db_session.commit()

    tags = (await db_session.execute(select(Tag).where(Tag.name == "shared").order_by(Tag.owner_user_id))).scalars().all()
    media_tags = (await db_session.execute(select(MediaTag).where(MediaTag.tag_id.in_([tag.id for tag in tags])))).scalars().all()

    assert len(tags) == 2
    assert {tag.owner_user_id for tag in tags} == {owner_a.id, owner_b.id}
    assert {media_tag.tag_id for media_tag in media_tags} == {tag.id for tag in tags}
