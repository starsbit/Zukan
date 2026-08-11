from __future__ import annotations

import pytest
from sqlalchemy import select

from backend.app.models.relations import MediaEntity, MediaEntityType, OwnedEntity
from backend.app.repositories.relations import MediaEntityRepository
from backend.app.repositories.tags import TagRepository
from backend.app.schemas import MetadataListScope
from backend.app.services.relations import RelationService
from backend.app.services.tags import TagService


@pytest.mark.asyncio
async def test_tag_management_merge_and_remove_are_owner_isolated(db_session, make_user, make_media):
    owner_a = await make_user(username="owner_a")
    owner_b = await make_user(username="owner_b")
    media_a_remove = await make_media(uploader_id=owner_a.id)
    media_a_merge_source = await make_media(uploader_id=owner_a.id)
    media_a_merge_target = await make_media(uploader_id=owner_a.id)
    media_b = await make_media(uploader_id=owner_b.id)

    tag_repo = TagRepository(db_session)
    await tag_repo.set_media_tag_links(media_a_remove, [("edited", 0, 0.9)])
    await tag_repo.set_media_tag_links(media_a_merge_source, [("legacy", 0, 0.8)])
    await tag_repo.set_media_tag_links(media_a_merge_target, [("shared", 0, 0.7)])
    await tag_repo.set_media_tag_links(media_b, [("edited", 0, 0.9), ("legacy", 0, 0.8), ("shared", 0, 0.7)])
    await db_session.commit()

    owner_a_tags = await tag_repo.get_by_names(owner_a.id, ["edited", "legacy", "shared"])
    owner_b_tags = await tag_repo.get_by_names(owner_b.id, ["edited", "legacy", "shared"])

    remove_result = await TagService(db_session).remove_tag_from_media(owner_a, source_tag=owner_a_tags["edited"])
    merge_result = await TagService(db_session).merge_tag(
        owner_a,
        source_tag=owner_a_tags["legacy"],
        target_tag=owner_a_tags["shared"],
    )

    assert remove_result.updated_media == 1
    assert merge_result.updated_media == 1

    owner_a_media_tags = {
        media_id: {
            media_tag.tag.name
            for media_tag in await tag_repo.get_media_tags_with_tag(media_id)
        }
        for media_id in [media_a_remove.id, media_a_merge_source.id, media_a_merge_target.id]
    }
    owner_b_media_tags = {
        media_tag.tag.name
        for media_tag in await tag_repo.get_media_tags_with_tag(media_b.id)
    }

    assert owner_a_media_tags[media_a_remove.id] == set()
    assert owner_a_media_tags[media_a_merge_source.id] == {"shared"}
    assert owner_a_media_tags[media_a_merge_target.id] == {"shared"}
    assert owner_b_media_tags == {"edited", "legacy", "shared"}

    remaining_owner_a_tags = await tag_repo.get_by_names(owner_a.id, ["edited", "legacy", "shared"])
    remaining_owner_b_tags = await tag_repo.get_by_names(owner_b.id, ["edited", "legacy", "shared"])
    assert set(remaining_owner_a_tags.keys()) == {"shared"}
    assert set(remaining_owner_b_tags.keys()) == {"edited", "legacy", "shared"}
    assert owner_b_tags["edited"].id == remaining_owner_b_tags["edited"].id
    assert owner_b_tags["legacy"].id == remaining_owner_b_tags["legacy"].id


@pytest.mark.asyncio
async def test_relation_management_merge_and_remove_are_owner_isolated(db_session, make_user, make_media):
    owner_a = await make_user(username="owner_a")
    owner_b = await make_user(username="owner_b")
    media_a_remove = await make_media(uploader_id=owner_a.id)
    media_a_merge_source = await make_media(uploader_id=owner_a.id)
    media_a_merge_target = await make_media(uploader_id=owner_a.id)
    media_b = await make_media(uploader_id=owner_b.id)

    repo = MediaEntityRepository(db_session)
    await repo.add_media_entities(media_a_remove, entity_type=MediaEntityType.character, names=["Delete Saber"], source="manual")
    await repo.add_media_entities(media_a_remove, entity_type=MediaEntityType.series, names=["Delete Fate"], source="manual")
    await repo.add_media_entities(media_a_merge_source, entity_type=MediaEntityType.character, names=["Saber"], source="manual")
    await repo.add_media_entities(media_a_merge_source, entity_type=MediaEntityType.series, names=["Fate"], source="manual")
    await repo.add_media_entities(media_a_merge_target, entity_type=MediaEntityType.character, names=["Artoria"], source="manual")
    await repo.add_media_entities(media_a_merge_target, entity_type=MediaEntityType.series, names=["Fate/stay night"], source="manual")
    await repo.add_media_entities(media_b, entity_type=MediaEntityType.character, names=["Delete Saber", "Saber"], source="manual")
    await repo.add_media_entities(media_b, entity_type=MediaEntityType.series, names=["Delete Fate", "Fate"], source="manual")
    await db_session.commit()

    service = RelationService(db_session)
    removed_character = await service.clear_character_name(owner_a, character_name="Delete Saber")
    removed_series = await service.clear_series_name(owner_a, series_name="Delete Fate")
    merged_character = await service.merge_character_name(owner_a, character_name="Saber", target_name="Artoria")
    merged_series = await service.merge_series_name(owner_a, series_name="Fate", target_name="Fate/stay night")

    assert removed_character.updated_media == 1
    assert removed_series.updated_media == 1
    assert merged_character.updated_media == 1
    assert merged_series.updated_media == 1

    owner_a_entities = (
        await db_session.execute(
            select(MediaEntity)
            .where(MediaEntity.media_id.in_([media_a_remove.id, media_a_merge_source.id, media_a_merge_target.id]))
            .order_by(MediaEntity.media_id, MediaEntity.entity_type, MediaEntity.name)
        )
    ).scalars().all()
    owner_b_entities = (
        await db_session.execute(
            select(MediaEntity)
            .where(MediaEntity.media_id == media_b.id)
            .order_by(MediaEntity.entity_type, MediaEntity.name)
        )
    ).scalars().all()

    owner_a_by_media = {
        media_id: {(str(entity.entity_type), entity.name) for entity in owner_a_entities if entity.media_id == media_id}
        for media_id in [media_a_remove.id, media_a_merge_source.id, media_a_merge_target.id]
    }
    owner_b_names = {(str(entity.entity_type), entity.name) for entity in owner_b_entities}

    assert owner_a_by_media[media_a_remove.id] == set()
    assert owner_a_by_media[media_a_merge_source.id] == {("character", "Artoria"), ("series", "Fate/stay night")}
    assert owner_a_by_media[media_a_merge_target.id] == {("character", "Artoria"), ("series", "Fate/stay night")}
    assert owner_b_names == {
        ("character", "Delete Saber"),
        ("character", "Saber"),
        ("series", "Delete Fate"),
        ("series", "Fate"),
    }

    owner_a_character_rows = await repo.list_entity_names(
        user=owner_a,
        entity_type=MediaEntityType.character,
        query=None,
        scope=MetadataListScope.OWNER,
    )
    owner_a_series_rows = await repo.list_entity_names(
        user=owner_a,
        entity_type=MediaEntityType.series,
        query=None,
        scope=MetadataListScope.OWNER,
    )
    owner_b_character_rows = await repo.list_entity_names(
        user=owner_b,
        entity_type=MediaEntityType.character,
        query=None,
        scope=MetadataListScope.OWNER,
    )
    owner_b_series_rows = await repo.list_entity_names(
        user=owner_b,
        entity_type=MediaEntityType.series,
        query=None,
        scope=MetadataListScope.OWNER,
    )

    assert [(row.name, row.media_count) for row in owner_a_character_rows] == [("Artoria", 2)]
    assert [(row.name, row.media_count) for row in owner_a_series_rows] == [("Fate/stay night", 2)]
    assert {row.name for row in owner_b_character_rows} == {"Delete Saber", "Saber"}
    assert {row.name for row in owner_b_series_rows} == {"Delete Fate", "Fate"}

    owned_entities = (
        await db_session.execute(
            select(OwnedEntity).order_by(OwnedEntity.owner_user_id, OwnedEntity.entity_type, OwnedEntity.name)
        )
    ).scalars().all()
    owner_a_owned = {
        (str(entity.entity_type), entity.name, entity.media_count)
        for entity in owned_entities
        if entity.owner_user_id == owner_a.id
    }
    owner_b_owned = {
        (str(entity.entity_type), entity.name, entity.media_count)
        for entity in owned_entities
        if entity.owner_user_id == owner_b.id
    }

    assert owner_a_owned == {
        ("character", "Artoria", 2),
        ("series", "Fate/stay night", 2),
    }
    assert owner_b_owned == {
        ("character", "Delete Saber", 1),
        ("character", "Saber", 1),
        ("series", "Delete Fate", 1),
        ("series", "Fate", 1),
    }


@pytest.mark.asyncio
async def test_tag_rename_to_fresh_name_keeps_id_and_media_links(db_session, make_user, make_media):
    owner = await make_user(username="rename_owner")
    media = await make_media(uploader_id=owner.id)

    tag_repo = TagRepository(db_session)
    await tag_repo.set_media_tag_links(media, [("typo_nam", 0, 0.9)])
    await db_session.commit()

    original = (await tag_repo.get_by_names(owner.id, ["typo_nam"]))["typo_nam"]

    result = await TagService(db_session).rename_tag_by_id(owner, tag_id=original.id, new_name="fixed_name")

    assert result.matched_media == 1
    assert result.updated_media == 1
    assert result.deleted_source is False

    renamed = await tag_repo.get_by_id(original.id)
    assert renamed is not None
    assert renamed.name == "fixed_name"
    media_tag_names = {mt.tag.name for mt in await tag_repo.get_media_tags_with_tag(media.id)}
    assert media_tag_names == {"fixed_name"}


@pytest.mark.asyncio
async def test_tag_rename_into_existing_name_merges_and_deletes_source(db_session, make_user, make_media):
    owner = await make_user(username="rename_merge_owner")
    media_source = await make_media(uploader_id=owner.id)
    media_target = await make_media(uploader_id=owner.id)

    tag_repo = TagRepository(db_session)
    await tag_repo.set_media_tag_links(media_source, [("old_name", 0, 0.9)])
    await tag_repo.set_media_tag_links(media_target, [("existing_name", 0, 0.5)])
    await db_session.commit()

    source_tag = (await tag_repo.get_by_names(owner.id, ["old_name"]))["old_name"]

    result = await TagService(db_session).rename_tag_by_id(owner, tag_id=source_tag.id, new_name="existing_name")

    assert result.updated_media == 1
    assert result.deleted_source is True

    remaining = await tag_repo.get_by_names(owner.id, ["old_name", "existing_name"])
    assert set(remaining.keys()) == {"existing_name"}
    source_media_tags = {mt.tag.name for mt in await tag_repo.get_media_tags_with_tag(media_source.id)}
    target_media_tags = {mt.tag.name for mt in await tag_repo.get_media_tags_with_tag(media_target.id)}
    assert source_media_tags == {"existing_name"}
    assert target_media_tags == {"existing_name"}


@pytest.mark.asyncio
async def test_tag_rename_is_owner_isolated(db_session, make_user, make_media):
    owner_a = await make_user(username="rename_iso_a")
    owner_b = await make_user(username="rename_iso_b")
    media_a = await make_media(uploader_id=owner_a.id)
    media_b = await make_media(uploader_id=owner_b.id)

    tag_repo = TagRepository(db_session)
    await tag_repo.set_media_tag_links(media_a, [("shared_name", 0, 0.9)])
    await tag_repo.set_media_tag_links(media_b, [("shared_name", 0, 0.9)])
    await db_session.commit()

    tag_a = await tag_repo.get_by_name(owner_a.id, "shared_name")
    tag_b = await tag_repo.get_by_name(owner_b.id, "shared_name")

    await TagService(db_session).rename_tag_by_id(owner_a, tag_id=tag_a.id, new_name="renamed_for_a")

    assert (await tag_repo.get_by_id(tag_a.id)).name == "renamed_for_a"
    assert (await tag_repo.get_by_id(tag_b.id)).name == "shared_name"


@pytest.mark.asyncio
async def test_relation_rename_to_fresh_name_cascades_across_media(db_session, make_user, make_media):
    owner = await make_user(username="relation_rename_owner")
    media_a = await make_media(uploader_id=owner.id)
    media_b = await make_media(uploader_id=owner.id)

    repo = MediaEntityRepository(db_session)
    await repo.add_media_entities(media_a, entity_type=MediaEntityType.character, names=["Saber"], source="manual")
    await repo.add_media_entities(media_b, entity_type=MediaEntityType.character, names=["Saber"], source="manual")
    await db_session.commit()

    service = RelationService(db_session)
    result = await service.rename_character_name(owner, character_name="Saber", new_name="Artoria Pendragon")

    assert result.matched_media == 2
    assert result.updated_media == 2
    assert result.deleted_source is True

    entities = (
        await db_session.execute(
            select(MediaEntity).where(MediaEntity.media_id.in_([media_a.id, media_b.id]))
        )
    ).scalars().all()
    assert {entity.name for entity in entities} == {"Artoria Pendragon"}

    owned_entities = (await db_session.execute(select(OwnedEntity).where(OwnedEntity.owner_user_id == owner.id))).scalars().all()
    assert len(owned_entities) == 1
    assert owned_entities[0].name == "Artoria Pendragon"
    assert owned_entities[0].media_count == 2


@pytest.mark.asyncio
async def test_relation_rename_into_existing_name_merges_and_removes_source_entity(db_session, make_user, make_media):
    owner = await make_user(username="relation_rename_merge_owner")
    media_source = await make_media(uploader_id=owner.id)
    media_target = await make_media(uploader_id=owner.id)

    repo = MediaEntityRepository(db_session)
    await repo.add_media_entities(media_source, entity_type=MediaEntityType.series, names=["Fate"], source="manual")
    await repo.add_media_entities(media_target, entity_type=MediaEntityType.series, names=["Fate/stay night"], source="manual")
    await db_session.commit()

    service = RelationService(db_session)
    result = await service.rename_series_name(owner, series_name="Fate", new_name="Fate/stay night")

    assert result.updated_media == 1
    assert result.deleted_source is True

    entities = (
        await db_session.execute(
            select(MediaEntity).where(MediaEntity.media_id.in_([media_source.id, media_target.id]))
        )
    ).scalars().all()
    assert {entity.name for entity in entities} == {"Fate/stay night"}

    owned_entities = (await db_session.execute(select(OwnedEntity).where(OwnedEntity.owner_user_id == owner.id))).scalars().all()
    assert [entity.name for entity in owned_entities] == ["Fate/stay night"]
    assert owned_entities[0].media_count == 2
