from __future__ import annotations
import uuid
import pytest
from backend.app.models.albums import Album, AlbumMedia
from backend.app.models.media import TaggingStatus
from backend.app.repositories.embeddings import MediaEmbeddingRepository

def _vector(*values: float) -> list[float]:
    padded = list(values) + [0.0] * (512 - len(values))
    return padded[:512]

@pytest.mark.asyncio
async def test_embedding_repository_upsert_updates_existing_rows(db_session, make_user, make_media):
    user = await make_user(username='embedder', email='embedder@example.com')
    media = await make_media(tagging_status=TaggingStatus.DONE)
    repo = MediaEmbeddingRepository(db_session)
    await repo.upsert(media_id=media.id, embedding=_vector(1.0, 0.0), model_version='test_v1')
    await db_session.flush()
    created = await repo.get_by_media_id(media.id)
    assert created is not None
    assert created.model_version == 'test_v1'
    await repo.upsert(media_id=media.id, embedding=_vector(0.0, 1.0), model_version='test_v2')
    await db_session.flush()
    await db_session.refresh(created)
    assert created.model_version == 'test_v2'
    assert created.embedding[:2] == pytest.approx([0.0, 1.0])

@pytest.mark.asyncio
async def test_embedding_repository_bulk_nearest_neighbors_scopes_and_excludes_targets(db_session, make_user, make_media):
    user = await make_user(username='bulk-owner', email='bulk-owner@example.com')
    target_one = await make_media(tagging_status=TaggingStatus.DONE)
    target_two = await make_media(tagging_status=TaggingStatus.DONE)
    neighbor_one = await make_media(tagging_status=TaggingStatus.DONE)
    neighbor_two = await make_media(tagging_status=TaggingStatus.DONE)
    repo = MediaEmbeddingRepository(db_session)
    await repo.upsert(media_id=target_one.id, embedding=_vector(1.0, 0.0, 0.0), model_version='test_v1')
    await repo.upsert(media_id=target_two.id, embedding=_vector(0.0, 1.0, 0.0), model_version='test_v1')
    await repo.upsert(media_id=neighbor_one.id, embedding=_vector(0.99, 0.01, 0.0), model_version='test_v1')
    await repo.upsert(media_id=neighbor_two.id, embedding=_vector(0.01, 0.99, 0.0), model_version='test_v1')
    await db_session.flush()
    neighbors = await repo.nearest_neighbors_for_media_ids(media_ids=[target_one.id, target_two.id], limit=1, model_version='test_v1', exclude_media_ids=[target_one.id, target_two.id])
    assert [neighbor.media_id for neighbor in neighbors[target_one.id]] == [neighbor_one.id]
    assert [neighbor.media_id for neighbor in neighbors[target_two.id]] == [neighbor_two.id]

@pytest.mark.asyncio
async def test_embedding_repository_accessible_neighbors_respects_classification_settings(db_session, make_user, make_media):
    viewer = await make_user(username='safe-viewer', email='safe-viewer@example.com')
    target = await make_media(tagging_status=TaggingStatus.DONE)
    safe_match = await make_media(tagging_status=TaggingStatus.DONE)
    nsfw_match = await make_media(tagging_status=TaggingStatus.DONE, is_nsfw=True)
    sensitive_match = await make_media(tagging_status=TaggingStatus.DONE, is_sensitive=True)
    repo = MediaEmbeddingRepository(db_session)
    for media, vector in [(target, _vector(1.0, 0.0, 0.0)), (nsfw_match, _vector(0.99, 0.01, 0.0)), (sensitive_match, _vector(0.98, 0.02, 0.0)), (safe_match, _vector(0.9, 0.1, 0.0))]:
        await repo.upsert(media_id=media.id, embedding=vector, model_version='test_v1')
    await db_session.flush()
    hidden_neighbors = await repo.nearest_accessible_neighbors(media_id=target.id, user=viewer, limit=8, model_version='test_v1')
    assert [neighbor.media_id for neighbor in hidden_neighbors] == [safe_match.id]
    viewer.show_nsfw = True
    viewer.show_sensitive = True
    visible_neighbors = await repo.nearest_accessible_neighbors(media_id=target.id, user=viewer, limit=8, model_version='test_v1')
    assert [neighbor.media_id for neighbor in visible_neighbors] == [nsfw_match.id, sensitive_match.id, safe_match.id]
    viewer.is_admin = True
    viewer.show_nsfw = False
    viewer.show_sensitive = False
    admin_hidden_neighbors = await repo.nearest_accessible_neighbors(media_id=target.id, user=viewer, limit=8, model_version='test_v1')
    assert [neighbor.media_id for neighbor in admin_hidden_neighbors] == [safe_match.id]

@pytest.mark.asyncio
async def test_embedding_repository_accessible_neighbors_returns_empty_without_target_embedding(db_session, make_user, make_media):
    viewer = await make_user(username='missing-target', email='missing-target@example.com')
    target = await make_media(tagging_status=TaggingStatus.DONE)
    other = await make_media(tagging_status=TaggingStatus.DONE)
    repo = MediaEmbeddingRepository(db_session)
    await repo.upsert(media_id=other.id, embedding=_vector(1.0, 0.0, 0.0), model_version='test_v1')
    await db_session.flush()
    neighbors = await repo.nearest_accessible_neighbors(media_id=target.id, user=viewer, limit=8, model_version='test_v1')
    assert neighbors == []
