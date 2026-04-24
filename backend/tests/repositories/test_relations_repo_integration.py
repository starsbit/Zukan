from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.models.media import MediaVisibility
from backend.app.models.relations import MediaEntity, MediaEntityType, MediaExternalRef, OwnedEntity
from backend.app.repositories.relations import MediaEntityRepository, MediaExternalRefRepository, OwnedEntityRepository
from backend.app.schemas import EntityCreate, MetadataListScope


@pytest.mark.asyncio
async def test_media_entity_repository_queries(db_session, make_user, make_media):
    user = await make_user()
    safe_media = await make_media(uploader_id=user.id, is_nsfw=False)
    nsfw_media = await make_media(uploader_id=user.id, is_nsfw=True)

    repo = MediaEntityRepository(db_session)
    await repo.add_media_entities(safe_media, entity_type=MediaEntityType.character, names=["Saber"], source="tagger", confidence=0.9)
    await repo.add_media_entities(safe_media, entity_type=MediaEntityType.character, names=["Rin"], source="manual", confidence=0.8)
    await repo.add_media_entities(nsfw_media, entity_type=MediaEntityType.character, names=["Saber"], source="tagger", confidence=0.7)
    await repo.add_media_entities(safe_media, entity_type=MediaEntityType.series, names=["Fate"], source="tagger", confidence=0.92)

    assert len(await repo.get_by_media(safe_media.id)) == 3
    assert [e.name for e in await repo.get_tagger_char_entities(safe_media.id)] == ["Saber"]
    assert [e.name for e in await repo.get_tagger_series_entities(safe_media.id)] == ["Fate"]
    named = await repo.get_char_entities_by_name({safe_media.id, nsfw_media.id}, "Saber")
    assert {e.media_id for e in named} == {safe_media.id, nsfw_media.id}
    series_named = await repo.get_series_entities_by_name({safe_media.id}, "Fate")
    assert {e.media_id for e in series_named} == {safe_media.id}

    suggestions = await repo.list_character_suggestions(user=user, query="Sa", limit=10)
    assert suggestions[0]["name"] == "Saber"
    assert suggestions[0]["media_count"] == 2
    series_suggestions = await repo.list_series_suggestions(user=user, query="Fa", limit=10)
    assert series_suggestions[0]["name"] == "Fate"
    assert series_suggestions[0]["media_count"] == 1


@pytest.mark.asyncio
async def test_media_entity_suggestions_include_public_but_not_private_other_media(db_session, make_user, make_media):
    viewer = await make_user()
    public_owner = await make_user()
    private_owner = await make_user()

    own_media = await make_media(uploader_id=viewer.id)
    public_media = await make_media(uploader_id=public_owner.id, visibility=MediaVisibility.public)
    private_media = await make_media(uploader_id=private_owner.id)

    repo = MediaEntityRepository(db_session)
    await repo.add_media_entities(own_media, entity_type=MediaEntityType.character, names=["Saber"], source="manual")
    await repo.add_media_entities(public_media, entity_type=MediaEntityType.character, names=["Saber"], source="manual")
    await repo.add_media_entities(private_media, entity_type=MediaEntityType.character, names=["Secret"], source="manual")

    suggestions = await repo.list_character_suggestions(user=viewer, query="S", limit=10)

    assert suggestions[0]["name"] == "Saber"
    assert suggestions[0]["media_count"] == 2
    assert all(item["name"] != "Secret" for item in suggestions)


@pytest.mark.asyncio
async def test_media_entity_name_lists_support_owner_scope(db_session, make_user, make_media):
    viewer = await make_user()
    public_owner = await make_user()

    own_media = await make_media(uploader_id=viewer.id)
    public_media = await make_media(uploader_id=public_owner.id, visibility=MediaVisibility.public)

    repo = MediaEntityRepository(db_session)
    await repo.add_media_entities(own_media, entity_type=MediaEntityType.character, names=["Saber"], source="manual")
    await repo.add_media_entities(public_media, entity_type=MediaEntityType.character, names=["Saber"], source="manual")
    await repo.add_media_entities(own_media, entity_type=MediaEntityType.series, names=["Fate"], source="manual")
    await repo.add_media_entities(public_media, entity_type=MediaEntityType.series, names=["Fate"], source="manual")

    char_total = await repo.count_entity_names(
        user=viewer,
        entity_type=MediaEntityType.character,
        query="Sab",
        scope=MetadataListScope.OWNER,
    )
    char_rows = await repo.list_entity_names(
        user=viewer,
        entity_type=MediaEntityType.character,
        query="Sab",
        scope=MetadataListScope.OWNER,
    )
    series_rows = await repo.list_entity_names(
        user=viewer,
        entity_type=MediaEntityType.series,
        query="Fa",
        scope=MetadataListScope.OWNER,
    )

    assert char_total == 1
    assert [(row.name, row.media_count) for row in char_rows] == [("Saber", 1)]
    assert [(row.name, row.media_count) for row in series_rows] == [("Fate", 1)]


@pytest.mark.asyncio
async def test_media_entity_queries_support_fuzzy_matching(db_session, make_user, make_media):
    viewer = await make_user()
    media = await make_media(uploader_id=viewer.id)

    repo = MediaEntityRepository(db_session)
    await repo.add_media_entities(media, entity_type=MediaEntityType.character, names=["nero_claudius_(fate/extra)"], source="manual")
    await repo.add_media_entities(media, entity_type=MediaEntityType.series, names=["fate/stay_night"], source="manual")

    char_suggestions = await repo.list_character_suggestions(user=viewer, query="fate extra", limit=10)
    char_rows = await repo.list_entity_names(
        user=viewer,
        entity_type=MediaEntityType.character,
        query="claudius",
        scope=MetadataListScope.OWNER,
    )
    series_rows = await repo.list_entity_names(
        user=viewer,
        entity_type=MediaEntityType.series,
        query="stay night",
        scope=MetadataListScope.OWNER,
    )

    assert [item["name"] for item in char_suggestions] == ["nero_claudius_(fate/extra)"]
    assert [(row.name, row.media_count) for row in char_rows] == [("nero_claudius_(fate/extra)", 1)]
    assert [(row.name, row.media_count) for row in series_rows] == [("fate/stay_night", 1)]


@pytest.mark.asyncio
async def test_entity_suggestions_match_name_on_token_boundaries(db_session, make_user, make_media):
    viewer = await make_user()
    aru = await make_media(uploader_id=viewer.id)
    koharu = await make_media(uploader_id=viewer.id)
    repo = MediaEntityRepository(db_session)

    await repo.add_media_entities(
        aru,
        entity_type=MediaEntityType.character,
        names=["Aru (Blue Archive)"],
        source="manual",
    )
    await repo.add_media_entities(
        koharu,
        entity_type=MediaEntityType.character,
        names=["Koharu (Blue Archive)"],
        source="manual",
    )

    suggestions = await repo.list_character_suggestions(
        user=viewer,
        query="Aru (Blue Archive)",
        limit=10,
    )
    rows = await repo.list_entity_names(
        user=viewer,
        entity_type=MediaEntityType.character,
        query="Aru (Blue Archive)",
        scope=MetadataListScope.OWNER,
    )

    assert [item["name"] for item in suggestions] == ["Aru (Blue Archive)"]
    assert [(row.name, row.media_count) for row in rows] == [("Aru (Blue Archive)", 1)]


@pytest.mark.asyncio
async def test_owned_entity_preserves_tagger_slug_apostrophe(db_session, make_user):
    viewer = await make_user()
    repo = OwnedEntityRepository(db_session)

    entity = await repo.get_or_create(
        owner_user_id=viewer.id,
        entity_type=MediaEntityType.character,
        name="jeanne_d'arc_(fate)",
    )
    assert entity.name == "jeanne_d'arc_(fate)"
    assert entity.normalized_name == "jeanne_d_arc_fate"


@pytest.mark.asyncio
async def test_add_media_entities_dedupes_names_by_normalized_value(db_session, make_user, make_media):
    viewer = await make_user()
    media = await make_media(uploader_id=viewer.id)

    await MediaEntityRepository(db_session).add_media_entities(
        media,
        entity_type=MediaEntityType.character,
        names=["Kazuki Kazami", "Kazuki_Kazami", "kazuki   kazami"],
        source="manual",
    )

    media_entities = (
        await db_session.execute(
            select(MediaEntity).where(
                MediaEntity.media_id == media.id,
                MediaEntity.entity_type == MediaEntityType.character,
            )
        )
    ).scalars().all()
    owned_entities = (
        await db_session.execute(
            select(OwnedEntity).where(
                OwnedEntity.owner_user_id == viewer.id,
                OwnedEntity.entity_type == MediaEntityType.character,
                OwnedEntity.normalized_name == "kazuki_kazami",
            )
        )
    ).scalars().all()

    assert [entity.name for entity in media_entities] == ["Kazuki Kazami"]
    assert [entity.name for entity in owned_entities] == ["Kazuki Kazami"]


@pytest.mark.asyncio
async def test_replace_media_entities_dedupes_names_by_normalized_value(db_session, make_user, make_media):
    viewer = await make_user()
    media = await make_media(uploader_id=viewer.id)

    await MediaEntityRepository(db_session).replace_media_entities(
        media,
        entity_creates=[
            EntityCreate(entity_type=MediaEntityType.character, name="Kazuki Kazami", role="primary"),
            EntityCreate(entity_type=MediaEntityType.character, name="Kazuki_Kazami", role="primary"),
            EntityCreate(entity_type=MediaEntityType.series, name="Grisaia no Kajitsu", role="primary"),
        ],
        source="manual",
    )

    media_entities = (
        await db_session.execute(
            select(MediaEntity).where(MediaEntity.media_id == media.id).order_by(MediaEntity.entity_type)
        )
    ).scalars().all()

    assert [(entity.entity_type, entity.name) for entity in media_entities] == [
        (MediaEntityType.character, "Kazuki Kazami"),
        (MediaEntityType.series, "Grisaia no Kajitsu"),
    ]


@pytest.mark.asyncio
async def test_owned_entity_get_or_create_handles_concurrent_create(db_engine, db_session, make_user):
    viewer = await make_user()
    await db_session.commit()
    session_maker = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    first_inserted = asyncio.Event()
    allow_first_commit = asyncio.Event()

    async def first_create():
        async with session_maker() as session:
            entity = await OwnedEntityRepository(session).get_or_create(
                owner_user_id=viewer.id,
                entity_type=MediaEntityType.character,
                name="Kazuki Kazami",
            )
            first_inserted.set()
            await allow_first_commit.wait()
            await session.commit()
            return entity.id

    async def second_create():
        await first_inserted.wait()
        async with session_maker() as session:
            entity = await OwnedEntityRepository(session).get_or_create(
                owner_user_id=viewer.id,
                entity_type=MediaEntityType.character,
                name="Kazuki_Kazami",
            )
            await session.commit()
            return entity.id

    first_task = asyncio.create_task(first_create())
    second_task = asyncio.create_task(second_create())
    await first_inserted.wait()
    await asyncio.sleep(0.1)
    allow_first_commit.set()

    entity_ids = await asyncio.gather(first_task, second_task)

    async with session_maker() as session:
        entities = (
            await session.execute(
                select(OwnedEntity).where(
                    OwnedEntity.owner_user_id == viewer.id,
                    OwnedEntity.entity_type == MediaEntityType.character,
                    OwnedEntity.normalized_name == "kazuki_kazami",
                )
            )
        ).scalars().all()

    assert len(entities) == 1
    assert set(entity_ids) == {entities[0].id}
    assert entities[0].name == "Kazuki_Kazami"


@pytest.mark.asyncio
async def test_media_external_ref_repository_query(db_session, make_user, make_media):
    user = await make_user()
    media = await make_media(uploader_id=user.id)
    ref = MediaExternalRef(media_id=media.id, provider="pixiv", external_id="1", url="https://x")
    db_session.add(ref)
    await db_session.flush()

    repo = MediaExternalRefRepository(db_session)
    rows = await repo.get_by_media(media.id)
    assert len(rows) == 1
    assert rows[0].provider == "pixiv"
