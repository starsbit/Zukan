import asyncio
import io
import uuid
import pytest
from PIL import Image
from sqlalchemy import select, text
from backend.app.config import settings
from backend.app.models.media import Media
from backend.app.models.tags import Tag
from backend.app.models.relations import OwnedEntity
from backend.app.repositories.media import MediaRepository
from backend.app.repositories.tags import TagRepository
from backend.app.repositories.relations import OwnedEntityRepository
from backend.app.models.relations import MediaEntityType
from .test_authentication import setup, bearer


@pytest.mark.asyncio
async def test_upload_album_favorite_and_metadata_journey(
    owner_client, tmp_path, monkeypatch
):
    from backend.app.services import media as media_service
    from backend.app.services import library_storage
    from backend.app.services.storage_gate import storage_gate

    client, maker = owner_client
    monkeypatch.setattr(settings, "storage_dir", tmp_path)
    monkeypatch.setattr(settings, "library_paths_relative", False)
    monkeypatch.setattr(settings, "library_root_identity", None)
    monkeypatch.setattr(media_service, "_tag_queue", asyncio.Queue())
    monkeypatch.setattr(library_storage, "AsyncSessionLocal", maker)
    await library_storage.initialize_library()
    tokens = await setup(client)
    headers = bearer(tokens)
    output = io.BytesIO()
    Image.new("RGB", (16, 16), "red").save(output, format="PNG")
    uploaded = await client.post(
        "/api/v1/media",
        headers=headers,
        files={"files": ("test.png", output.getvalue(), "image/png")},
    )
    assert uploaded.status_code == 202, uploaded.text
    mid = uploaded.json()["results"][0]["id"]
    assert mid
    duplicate = await client.post(
        "/api/v1/media",
        headers=headers,
        files={"files": ("again.png", output.getvalue(), "image/png")},
    )
    assert duplicate.status_code == 202, duplicate.text
    assert duplicate.json()["duplicates"] == 1
    gallery = await client.get("/api/v1/media", headers=headers)
    assert gallery.status_code == 200 and gallery.json()["total"] == 1
    assert not {"owner_id", "uploader_id", "visibility"}.intersection(
        gallery.json()["items"][0]
    )
    album = await client.post(
        "/api/v1/albums", headers=headers, json={"name": "My album"}
    )
    assert album.status_code == 201, album.text
    aid = album.json()["id"]
    added = await client.put(
        f"/api/v1/albums/{aid}/media", headers=headers, json={"media_ids": [mid]}
    )
    assert added.status_code in (200, 201), added.text
    detail = await client.get(f"/api/v1/media/{mid}", headers=headers)
    assert detail.status_code == 200, detail.text
    updated = await client.patch(
        f"/api/v1/media/{mid}",
        headers=headers,
        json={"favorited": True, "tags": ["red"], "version": detail.json()["version"]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["is_favorited"] is True
    assert "red" in updated.json()["tags"]
    assert (
        await client.get("/api/v1/media", headers=headers, params={"favorited": True})
    ).json()["total"] == 1
    assert (await client.get("/api/v1/tags", headers=headers)).json()["total"] == 1
    assert (
        await client.get("/api/v1/admin/storage", headers=headers)
    ).status_code == 200
    for path in ("review-items", "review-summary"):
        reviewed = await client.get(
            "/api/v1/me/import-batches/" + path, headers=headers
        )
        assert reviewed.status_code == 200, reviewed.text
    assert (
        await client.delete(f"/api/v1/media/{mid}", headers=headers)
    ).status_code == 204
    assert (
        await client.post(f"/api/v1/media/{mid}/restore", headers=headers)
    ).status_code == 204


@pytest.mark.asyncio
async def test_legacy_duplicate_lookup_and_global_metadata(owner_client):
    client, maker = owner_client
    await setup(client)
    ids = [uuid.uuid4(), uuid.uuid4()]
    async with maker() as db:
        for mid in ids:
            db.add(
                Media(
                    id=mid,
                    filename=f"{mid}.png",
                    filepath=f"{mid}.png",
                    sha256="duplicate",
                    media_type="image",
                    captured_at=__import__("datetime").datetime.now(
                        __import__("datetime").UTC
                    ),
                )
            )
        await db.commit()
        found = await MediaRepository(db).get_by_sha256("duplicate")
        assert found.id in ids
        again = await MediaRepository(db).get_by_sha256("duplicate")
        assert again.id == found.id
        for mid in ids:
            media = await db.get(Media, mid)
            await TagRepository(db).set_media_tag_links(media, [("same", 0, 1.0)])
            await OwnedEntityRepository(db).get_or_create(
                entity_type=MediaEntityType.character, name="Saber"
            )
        await db.commit()
        assert len((await db.scalars(select(Tag))).all()) == 1
        assert len((await db.scalars(select(OwnedEntity))).all()) == 1
