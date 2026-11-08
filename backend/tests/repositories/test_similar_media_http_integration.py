from __future__ import annotations

import uuid

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from backend.app.database import get_db
from backend.app.errors.error import AppError
from backend.app.main import app_error_handler, v1_router
from backend.app.ml.embedding import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_VERSION
from backend.app.models.media import TaggingStatus
from backend.app.repositories.embeddings import MediaEmbeddingRepository
from backend.app.routers.deps import current_user


def _vector(*values: float) -> list[float]:
    return (list(values) + [0.0] * EMBEDDING_DIMENSIONS)[:EMBEDDING_DIMENSIONS]


@pytest_asyncio.fixture
async def viewer(make_user):
    return await make_user(username="similar-viewer", email="similar-viewer@example.com")


@pytest_asyncio.fixture
async def client(db_session, viewer):
    app = FastAPI()
    app.include_router(v1_router)
    app.add_exception_handler(AppError, app_error_handler)

    async def _db_override():
        yield db_session

    async def _user_override():
        return viewer

    app.dependency_overrides[get_db] = _db_override
    app.dependency_overrides[current_user] = _user_override
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


@pytest_asyncio.fixture
async def embed(db_session):
    repo = MediaEmbeddingRepository(db_session)

    async def _embed(media, *values: float, model_version: str = EMBEDDING_MODEL_VERSION) -> None:
        await repo.upsert(media_id=media.id, embedding=_vector(*values), model_version=model_version)
        await db_session.flush()

    return _embed


async def _walk(client, media_id, page_size: int) -> list[dict]:
    pages = []
    after = None
    while True:
        params = {"page_size": page_size}
        if after:
            params["after"] = after
        response = await client.get(f"/api/v1/media/{media_id}/similar", params=params)
        assert response.status_code == 200
        body = response.json()
        pages.append(body)
        if not body["has_more"]:
            return pages
        after = body["next_cursor"]


@pytest.mark.asyncio
async def test_similar_pages_walk_closest_first_without_gaps(client, make_media, embed):
    target = await make_media(tagging_status=TaggingStatus.DONE)
    await embed(target, 1.0, 0.0)
    expected = []
    for index in range(5):
        media = await make_media(tagging_status=TaggingStatus.DONE)
        await embed(media, 1.0, 0.1 * (index + 1))
        expected.append(str(media.id))

    pages = await _walk(client, target.id, page_size=2)

    assert [len(page["items"]) for page in pages] == [2, 2, 1]
    assert pages[-1]["next_cursor"] is None
    items = [item for page in pages for item in page["items"]]
    assert [item["id"] for item in items] == expected
    similarities = [item["similarity"] for item in items]
    assert similarities == sorted(similarities, reverse=True)


@pytest.mark.asyncio
async def test_similar_excludes_target_hidden_deleted_and_other_model_versions(
    client, make_media, embed
):
    target = await make_media(tagging_status=TaggingStatus.DONE)
    visible = await make_media(tagging_status=TaggingStatus.DONE)
    nsfw = await make_media(tagging_status=TaggingStatus.DONE, is_nsfw=True)
    sensitive = await make_media(tagging_status=TaggingStatus.DONE, is_sensitive=True)
    deleted = await make_media(tagging_status=TaggingStatus.DONE, deleted=True)
    old_model = await make_media(tagging_status=TaggingStatus.DONE)
    await embed(target, 1.0, 0.0)
    await embed(visible, 1.0, 0.5)
    for media in (nsfw, sensitive, deleted):
        await embed(media, 1.0, 0.1)
    await embed(old_model, 1.0, 0.1, model_version="retired_model")

    response = await client.get(f"/api/v1/media/{target.id}/similar")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [str(visible.id)]


@pytest.mark.asyncio
async def test_similar_shows_hidden_media_when_the_viewer_allows_it(
    client, viewer, make_media, embed
):
    viewer.show_nsfw = True
    viewer.show_sensitive = True
    target = await make_media(tagging_status=TaggingStatus.DONE)
    nsfw = await make_media(tagging_status=TaggingStatus.DONE, is_nsfw=True)
    await embed(target, 1.0, 0.0)
    await embed(nsfw, 1.0, 0.1)

    response = await client.get(f"/api/v1/media/{target.id}/similar")

    assert [item["id"] for item in response.json()["items"]] == [str(nsfw.id)]


@pytest.mark.asyncio
async def test_similar_pages_through_the_whole_library(client, make_media, embed):
    target = await make_media(tagging_status=TaggingStatus.DONE)
    await embed(target, 1.0, 0.0)
    for index in range(5):
        await embed(await make_media(tagging_status=TaggingStatus.DONE), 1.0, 0.1 * (index + 1))

    pages = await _walk(client, target.id, page_size=2)

    ids = [item["id"] for page in pages for item in page["items"]]
    assert len(ids) == 5
    assert len(set(ids)) == 5
    assert pages[-1]["has_more"] is False


@pytest.mark.asyncio
async def test_similar_is_empty_without_an_embedding(client, make_media, embed):
    target = await make_media(tagging_status=TaggingStatus.DONE)
    await embed(await make_media(tagging_status=TaggingStatus.DONE), 1.0, 0.0)

    response = await client.get(f"/api/v1/media/{target.id}/similar")

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["has_more"] is False


@pytest.mark.asyncio
async def test_similar_returns_404_for_unknown_media(client):
    response = await client.get(f"/api/v1/media/{uuid.uuid4()}/similar")

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_similar_allows_nsfw_target_when_user_hides_nsfw(client, make_media, embed):
    # show_nsfw only filters default listings; an NSFW item reached through an
    # explicit nsfw=include|only search must still open (detail, similar, files).
    target = await make_media(tagging_status=TaggingStatus.DONE, is_nsfw=True)
    await embed(target, 1.0, 0.0)

    response = await client.get(f"/api/v1/media/{target.id}/similar")

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_similar_ignores_a_malformed_cursor(client, make_media, embed):
    target = await make_media(tagging_status=TaggingStatus.DONE)
    match = await make_media(tagging_status=TaggingStatus.DONE)
    await embed(target, 1.0, 0.0)
    await embed(match, 1.0, 0.1)

    response = await client.get(
        f"/api/v1/media/{target.id}/similar", params={"after": "not-a-cursor"}
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [str(match.id)]
