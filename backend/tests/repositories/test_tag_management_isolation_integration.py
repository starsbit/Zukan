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
async def test_tag_rename_to_fresh_name_keeps_id_and_media_links(db_session, make_user, make_media):
    owner = await make_user(username='rename_owner')
    media = await make_media()
    tag_repo = TagRepository(db_session)
    await tag_repo.set_media_tag_links(media, [('typo_nam', 0, 0.9)])
    await db_session.commit()
    original = (await tag_repo.get_by_names(['typo_nam']))['typo_nam']
    result = await TagService(db_session).rename_tag_by_id(owner, tag_id=original.id, new_name='fixed_name')
    assert result.matched_media == 1
    assert result.updated_media == 1
    assert result.deleted_source is False
    renamed = await tag_repo.get_by_id(original.id)
    assert renamed is not None
    assert renamed.name == 'fixed_name'
    media_tag_names = {mt.tag.name for mt in await tag_repo.get_media_tags_with_tag(media.id)}
    assert media_tag_names == {'fixed_name'}

@pytest.mark.asyncio
async def test_tag_rename_into_existing_name_merges_and_deletes_source(db_session, make_user, make_media):
    owner = await make_user(username='rename_merge_owner')
    media_source = await make_media()
    media_target = await make_media()
    tag_repo = TagRepository(db_session)
    await tag_repo.set_media_tag_links(media_source, [('old_name', 0, 0.9)])
    await tag_repo.set_media_tag_links(media_target, [('existing_name', 0, 0.5)])
    await db_session.commit()
    source_tag = (await tag_repo.get_by_names(['old_name']))['old_name']
    result = await TagService(db_session).rename_tag_by_id(owner, tag_id=source_tag.id, new_name='existing_name')
    assert result.updated_media == 1
    assert result.deleted_source is True
    remaining = await tag_repo.get_by_names(['old_name', 'existing_name'])
    assert set(remaining.keys()) == {'existing_name'}
    source_media_tags = {mt.tag.name for mt in await tag_repo.get_media_tags_with_tag(media_source.id)}
    target_media_tags = {mt.tag.name for mt in await tag_repo.get_media_tags_with_tag(media_target.id)}
    assert source_media_tags == {'existing_name'}
    assert target_media_tags == {'existing_name'}

@pytest.mark.asyncio
async def test_relation_rename_to_fresh_name_cascades_across_media(db_session, make_user, make_media):
    owner = await make_user(username='relation_rename_owner')
    media_a = await make_media()
    media_b = await make_media()
    repo = MediaEntityRepository(db_session)
    await repo.add_media_entities(media_a, entity_type=MediaEntityType.character, names=['Saber'], source='manual')
    await repo.add_media_entities(media_b, entity_type=MediaEntityType.character, names=['Saber'], source='manual')
    await db_session.commit()
    service = RelationService(db_session)
    result = await service.rename_character_name(owner, character_name='Saber', new_name='Artoria Pendragon')
    assert result.matched_media == 2
    assert result.updated_media == 2
    assert result.deleted_source is True
    entities = (await db_session.execute(select(MediaEntity).where(MediaEntity.media_id.in_([media_a.id, media_b.id])))).scalars().all()
    assert {entity.name for entity in entities} == {'Artoria Pendragon'}
    owned_entities = (await db_session.execute(select(OwnedEntity))).scalars().all()
    assert len(owned_entities) == 1
    assert owned_entities[0].name == 'Artoria Pendragon'
    assert owned_entities[0].media_count == 2

@pytest.mark.asyncio
async def test_relation_rename_into_existing_name_merges_and_removes_source_entity(db_session, make_user, make_media):
    owner = await make_user(username='relation_rename_merge_owner')
    media_source = await make_media()
    media_target = await make_media()
    repo = MediaEntityRepository(db_session)
    await repo.add_media_entities(media_source, entity_type=MediaEntityType.series, names=['Fate'], source='manual')
    await repo.add_media_entities(media_target, entity_type=MediaEntityType.series, names=['Fate/stay night'], source='manual')
    await db_session.commit()
    service = RelationService(db_session)
    result = await service.rename_series_name(owner, series_name='Fate', new_name='Fate/stay night')
    assert result.updated_media == 1
    assert result.deleted_source is True
    entities = (await db_session.execute(select(MediaEntity).where(MediaEntity.media_id.in_([media_source.id, media_target.id])))).scalars().all()
    assert {entity.name for entity in entities} == {'Fate/stay night'}
    owned_entities = (await db_session.execute(select(OwnedEntity))).scalars().all()
    assert [entity.name for entity in owned_entities] == ['Fate/stay night']
    assert owned_entities[0].media_count == 2
