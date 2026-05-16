from __future__ import annotations

import uuid

import pytest

from backend.app.models.albums import Album, AlbumMedia, AlbumShare, AlbumShareRole
from backend.app.models.media import MediaVisibility, TaggingStatus
from backend.app.repositories.embeddings import MediaEmbeddingRepository


def _vector(*values: float) -> list[float]:
    padded = list(values) + [0.0] * (512 - len(values))
    return padded[:512]


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
        model_version="test_v1",
    )

    assert [neighbor.media_id for neighbor in neighbors] == [close_match.id, distant_match.id]
    assert neighbors[0].similarity > neighbors[1].similarity


@pytest.mark.asyncio
async def test_embedding_repository_bulk_nearest_neighbors_scopes_and_excludes_targets(db_session, make_user, make_media):
    user = await make_user(username="bulk-owner", email="bulk-owner@example.com")
    target_one = await make_media(uploader_id=user.id, tagging_status=TaggingStatus.DONE)
    target_two = await make_media(uploader_id=user.id, tagging_status=TaggingStatus.DONE)
    neighbor_one = await make_media(uploader_id=user.id, tagging_status=TaggingStatus.DONE)
    neighbor_two = await make_media(uploader_id=user.id, tagging_status=TaggingStatus.DONE)
    repo = MediaEmbeddingRepository(db_session)

    await repo.upsert(
        media_id=target_one.id,
        uploader_id=user.id,
        embedding=_vector(1.0, 0.0, 0.0),
        model_version="test_v1",
    )
    await repo.upsert(
        media_id=target_two.id,
        uploader_id=user.id,
        embedding=_vector(0.0, 1.0, 0.0),
        model_version="test_v1",
    )
    await repo.upsert(
        media_id=neighbor_one.id,
        uploader_id=user.id,
        embedding=_vector(0.99, 0.01, 0.0),
        model_version="test_v1",
    )
    await repo.upsert(
        media_id=neighbor_two.id,
        uploader_id=user.id,
        embedding=_vector(0.01, 0.99, 0.0),
        model_version="test_v1",
    )
    await db_session.flush()

    neighbors = await repo.nearest_neighbors_for_media_ids(
        media_ids=[target_one.id, target_two.id],
        uploader_id=user.id,
        limit=1,
        model_version="test_v1",
        exclude_media_ids=[target_one.id, target_two.id],
    )

    assert [neighbor.media_id for neighbor in neighbors[target_one.id]] == [neighbor_one.id]
    assert [neighbor.media_id for neighbor in neighbors[target_two.id]] == [neighbor_two.id]


@pytest.mark.asyncio
async def test_embedding_repository_accessible_neighbors_filter_and_order(db_session, make_user, make_media):
    viewer = await make_user(username="viewer", email="viewer@example.com")
    owner = await make_user(username="owner2", email="owner2@example.com")
    stranger = await make_user(username="stranger", email="stranger@example.com")
    target = await make_media(uploader_id=viewer.id, tagging_status=TaggingStatus.DONE)
    own_close = await make_media(uploader_id=viewer.id, tagging_status=TaggingStatus.DONE)
    public_match = await make_media(
        uploader_id=owner.id,
        visibility=MediaVisibility.public,
        tagging_status=TaggingStatus.DONE,
    )
    shared_match = await make_media(uploader_id=owner.id, tagging_status=TaggingStatus.DONE)
    private_match = await make_media(uploader_id=stranger.id, tagging_status=TaggingStatus.DONE)
    trashed_match = await make_media(uploader_id=viewer.id, tagging_status=TaggingStatus.DONE, deleted=True)
    processing_public = await make_media(
        uploader_id=owner.id,
        visibility=MediaVisibility.public,
        tagging_status=TaggingStatus.PROCESSING,
    )

    album = Album(id=uuid.uuid4(), owner_id=owner.id, name="Shared", version=1)
    db_session.add(album)
    await db_session.flush()
    db_session.add(AlbumMedia(album_id=album.id, media_id=shared_match.id, position=1))
    db_session.add(AlbumShare(album_id=album.id, user_id=viewer.id, role=AlbumShareRole.viewer, shared_by_user_id=owner.id))

    repo = MediaEmbeddingRepository(db_session)
    for media, vector in [
        (target, _vector(1.0, 0.0, 0.0)),
        (own_close, _vector(0.99, 0.01, 0.0)),
        (public_match, _vector(0.92, 0.08, 0.0)),
        (shared_match, _vector(0.85, 0.15, 0.0)),
        (private_match, _vector(0.98, 0.02, 0.0)),
        (trashed_match, _vector(0.97, 0.03, 0.0)),
        (processing_public, _vector(0.96, 0.04, 0.0)),
    ]:
        await repo.upsert(
            media_id=media.id,
            uploader_id=media.uploader_id,
            embedding=vector,
            model_version="test_v1",
        )
    await db_session.flush()

    neighbors = await repo.nearest_accessible_neighbors(
        media_id=target.id,
        user=viewer,
        limit=8,
        model_version="test_v1",
    )

    assert [neighbor.media_id for neighbor in neighbors] == [
        own_close.id,
        public_match.id,
        shared_match.id,
    ]
    assert neighbors[0].similarity > neighbors[1].similarity > neighbors[2].similarity


@pytest.mark.asyncio
async def test_embedding_repository_accessible_neighbors_respects_classification_settings(db_session, make_user, make_media):
    viewer = await make_user(username="safe-viewer", email="safe-viewer@example.com")
    target = await make_media(uploader_id=viewer.id, tagging_status=TaggingStatus.DONE)
    safe_match = await make_media(uploader_id=viewer.id, tagging_status=TaggingStatus.DONE)
    nsfw_match = await make_media(uploader_id=viewer.id, tagging_status=TaggingStatus.DONE, is_nsfw=True)
    sensitive_match = await make_media(uploader_id=viewer.id, tagging_status=TaggingStatus.DONE, is_sensitive=True)
    repo = MediaEmbeddingRepository(db_session)

    for media, vector in [
        (target, _vector(1.0, 0.0, 0.0)),
        (nsfw_match, _vector(0.99, 0.01, 0.0)),
        (sensitive_match, _vector(0.98, 0.02, 0.0)),
        (safe_match, _vector(0.9, 0.1, 0.0)),
    ]:
        await repo.upsert(
            media_id=media.id,
            uploader_id=media.uploader_id,
            embedding=vector,
            model_version="test_v1",
        )
    await db_session.flush()

    hidden_neighbors = await repo.nearest_accessible_neighbors(
        media_id=target.id,
        user=viewer,
        limit=8,
        model_version="test_v1",
    )
    assert [neighbor.media_id for neighbor in hidden_neighbors] == [safe_match.id]

    viewer.show_nsfw = True
    viewer.show_sensitive = True
    visible_neighbors = await repo.nearest_accessible_neighbors(
        media_id=target.id,
        user=viewer,
        limit=8,
        model_version="test_v1",
    )
    assert [neighbor.media_id for neighbor in visible_neighbors] == [
        nsfw_match.id,
        sensitive_match.id,
        safe_match.id,
    ]


@pytest.mark.asyncio
async def test_embedding_repository_accessible_neighbors_returns_empty_without_target_embedding(db_session, make_user, make_media):
    viewer = await make_user(username="missing-target", email="missing-target@example.com")
    target = await make_media(uploader_id=viewer.id, tagging_status=TaggingStatus.DONE)
    other = await make_media(uploader_id=viewer.id, tagging_status=TaggingStatus.DONE)
    repo = MediaEmbeddingRepository(db_session)
    await repo.upsert(
        media_id=other.id,
        uploader_id=viewer.id,
        embedding=_vector(1.0, 0.0, 0.0),
        model_version="test_v1",
    )
    await db_session.flush()

    neighbors = await repo.nearest_accessible_neighbors(
        media_id=target.id,
        user=viewer,
        limit=8,
        model_version="test_v1",
    )

    assert neighbors == []
