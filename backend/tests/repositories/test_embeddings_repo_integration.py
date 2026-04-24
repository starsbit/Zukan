from __future__ import annotations

import pytest

from backend.app.models.media import TaggingStatus
from backend.app.repositories.embeddings import MediaEmbeddingRepository


def _vector(*values: float) -> list[float]:
    padded = list(values) + [0.0] * (96 - len(values))
    return padded[:96]


@pytest.mark.asyncio
async def test_embedding_repository_upsert_updates_existing_rows(db_session, make_user, make_media):
    user = await make_user(username="embedder", email="embedder@example.com")
    media = await make_media(uploader_id=user.id, tagging_status=TaggingStatus.DONE)
    repo = MediaEmbeddingRepository(db_session)

    await repo.upsert(
        media_id=media.id,
        uploader_id=user.id,
        embedding=_vector(1.0, 0.0),
        model_version="test_v1",
    )
    await db_session.flush()

    created = await repo.get_by_media_id(media.id)
    assert created is not None
    assert created.model_version == "test_v1"

    await repo.upsert(
        media_id=media.id,
        uploader_id=user.id,
        embedding=_vector(0.0, 1.0),
        model_version="test_v2",
    )
    await db_session.flush()
    await db_session.refresh(created)

    assert created.model_version == "test_v2"
    assert created.embedding[:2] == pytest.approx([0.0, 1.0])


@pytest.mark.asyncio
async def test_embedding_repository_nearest_neighbors_scopes_to_uploader_and_excludes_self(db_session, make_user, make_media):
    user = await make_user(username="owner", email="owner@example.com")
    other_user = await make_user(username="other", email="other@example.com")
    target = await make_media(uploader_id=user.id, tagging_status=TaggingStatus.DONE)
    close_match = await make_media(uploader_id=user.id, tagging_status=TaggingStatus.DONE)
    distant_match = await make_media(uploader_id=user.id, tagging_status=TaggingStatus.DONE)
    foreign_match = await make_media(uploader_id=other_user.id, tagging_status=TaggingStatus.DONE)
    repo = MediaEmbeddingRepository(db_session)

    await repo.upsert(
        media_id=target.id,
        uploader_id=user.id,
        embedding=_vector(1.0, 0.0, 0.0),
        model_version="test_v1",
    )
    await repo.upsert(
        media_id=close_match.id,
        uploader_id=user.id,
        embedding=_vector(0.99, 0.01, 0.0),
        model_version="test_v1",
    )
    await repo.upsert(
        media_id=distant_match.id,
        uploader_id=user.id,
        embedding=_vector(0.0, 1.0, 0.0),
        model_version="test_v1",
    )
    await repo.upsert(
        media_id=foreign_match.id,
        uploader_id=other_user.id,
        embedding=_vector(1.0, 0.0, 0.0),
        model_version="test_v1",
    )
    await db_session.flush()

    neighbors = await repo.nearest_neighbors(
        media_id=target.id,
        uploader_id=user.id,
        embedding=_vector(1.0, 0.0, 0.0),
        limit=5,
    )

    assert [neighbor.media_id for neighbor in neighbors] == [close_match.id, distant_match.id]
    assert neighbors[0].similarity > neighbors[1].similarity
