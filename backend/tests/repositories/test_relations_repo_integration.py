from __future__ import annotations

import pytest

from backend.app.models.media import MediaVisibility
from backend.app.models.relations import MediaEntity, MediaEntityType, MediaExternalRef
from backend.app.repositories.relations import MediaEntityRepository, MediaExternalRefRepository
from backend.app.schemas import MetadataListScope


@pytest.mark.asyncio
async def test_media_entity_repository_queries(db_session, make_user, make_media):
    user = await make_user()
    safe_media = await make_media(uploader_id=user.id, is_nsfw=False)
    nsfw_media = await make_media(uploader_id=user.id, is_nsfw=True)

    e1 = MediaEntity(media_id=safe_media.id, entity_type=MediaEntityType.character, name="Saber", role="primary", source="tagger", confidence=0.9)
    e2 = MediaEntity(media_id=safe_media.id, entity_type=MediaEntityType.character, name="Rin", role="primary", source="manual", confidence=0.8)
    e3 = MediaEntity(media_id=nsfw_media.id, entity_type=MediaEntityType.character, name="Saber", role="primary", source="tagger", confidence=0.7)
    e4 = MediaEntity(media_id=safe_media.id, entity_type=MediaEntityType.series, name="Fate", role="primary", source="tagger", confidence=0.92)
    db_session.add_all([e1, e2, e3, e4])
    await db_session.flush()

    repo = MediaEntityRepository(db_session)
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

    db_session.add_all([
        MediaEntity(media_id=own_media.id, entity_type=MediaEntityType.character, name="Saber", role="primary", source="manual"),
        MediaEntity(media_id=public_media.id, entity_type=MediaEntityType.character, name="Saber", role="primary", source="manual"),
        MediaEntity(media_id=private_media.id, entity_type=MediaEntityType.character, name="Secret", role="primary", source="manual"),
    ])
    await db_session.flush()

    repo = MediaEntityRepository(db_session)
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

    db_session.add_all([
        MediaEntity(media_id=own_media.id, entity_type=MediaEntityType.character, name="Saber", role="primary", source="manual"),
        MediaEntity(media_id=public_media.id, entity_type=MediaEntityType.character, name="Saber", role="primary", source="manual"),
        MediaEntity(media_id=own_media.id, entity_type=MediaEntityType.series, name="Fate", role="primary", source="manual"),
        MediaEntity(media_id=public_media.id, entity_type=MediaEntityType.series, name="Fate", role="primary", source="manual"),
    ])
    await db_session.flush()

    repo = MediaEntityRepository(db_session)

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
