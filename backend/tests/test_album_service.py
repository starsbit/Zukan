import uuid

import pytest
from fastapi import HTTPException

from backend.app.models import Album
from backend.app.services import albums as album_service


def test_album_access_returns_full_access_for_owner():
    owner_id = uuid.uuid4()
    assert album_service.album_access(owner_id, owner_id, False, None) == (True, True)


def test_album_access_returns_shared_permissions():
    assert album_service.album_access(uuid.uuid4(), uuid.uuid4(), False, False) == (True, False)
    assert album_service.album_access(uuid.uuid4(), uuid.uuid4(), False, True) == (True, True)


def test_album_access_denies_unshared_user():
    assert album_service.album_access(uuid.uuid4(), uuid.uuid4(), False, None) == (False, False)


def test_get_album_for_user_raises_not_found_for_unshared_user(api):
    owner = api.register_and_login("album-service-owner")
    outsider = api.register_and_login("album-service-outsider")
    created = api.client.post(
        "/albums",
        headers=api.auth_headers(owner["access_token"]),
        json={"name": "Private Album"},
    )
    assert created.status_code == 201
    album_id = uuid.UUID(created.json()["id"])
    outsider_id = uuid.UUID(outsider["user"]["id"])

    async def _run(session):
        from backend.app.models import User

        outsider_user = await session.get(User, outsider_id)
        await album_service.get_album_for_user(session, album_id, outsider_user)

    with pytest.raises(HTTPException) as exc:
        api.run_db(_run)

    assert exc.value.status_code == 404
    assert exc.value.detail == "Album not found"


def test_bulk_add_and_remove_from_album_updates_cover_image(api):
    owner = api.register_and_login("album-service-editor")
    first = api.upload_media(owner["access_token"], "album-service-first.png", (0, 0, 255))
    second = api.upload_media(owner["access_token"], "album-service-second.png", (0, 255, 0))
    api.wait_for_media_status(str(first["id"]))
    api.wait_for_media_status(str(second["id"]))

    created = api.client.post(
        "/albums",
        headers=api.auth_headers(owner["access_token"]),
        json={"name": "Editable Album"},
    )
    assert created.status_code == 201
    album_id = uuid.UUID(created.json()["id"])
    owner_id = uuid.UUID(owner["user"]["id"])
    first_id = uuid.UUID(str(first["id"]))
    second_id = uuid.UUID(str(second["id"]))

    async def _exercise(session):
        from backend.app.models import User

        db_user = await session.get(User, owner_id)
        processed, skipped = await album_service.bulk_add_to_album(
            session,
            album_id,
            [first_id, second_id],
            db_user,
        )
        assert (processed, skipped) == (2, 0)

        album = await session.get(Album, album_id)
        assert album.cover_media_id == first_id

        processed, skipped = await album_service.bulk_remove_from_album(
            session,
            album_id,
            [first_id],
            db_user,
        )
        assert (processed, skipped) == (1, 0)

        await session.refresh(album)
        assert album.cover_media_id == second_id

    api.run_db(_exercise)


def test_album_service_crud_and_sharing_flow(api):
    owner = api.register_and_login("album-service-crud-owner")
    viewer = api.register_and_login("album-service-crud-viewer")
    owner_id = uuid.UUID(owner["user"]["id"])
    viewer_id = uuid.UUID(viewer["user"]["id"])

    async def _exercise(session):
        from backend.app.models import User
        from backend.app.schemas import AlbumShareCreate, AlbumUpdate

        owner_user = await session.get(User, owner_id)
        viewer_user = await session.get(User, viewer_id)

        created = await album_service.create_album(session, owner_user, "Trips", "Summer plans")
        assert created.name == "Trips"
        assert created.description == "Summer plans"

        owner_albums = await album_service.list_albums(session, owner_user)
        assert [album.id for album in owner_albums] == [created.id]

        viewer_albums = await album_service.list_albums(session, viewer_user)
        assert viewer_albums == []

        updated = await album_service.update_album(
            session,
            created.id,
            AlbumUpdate(name="Trips Updated", description="Packed"),
            owner_user,
        )
        assert updated.name == "Trips Updated"
        assert updated.description == "Packed"

        share = await album_service.share_album(
            session,
            created.id,
            AlbumShareCreate(user_id=viewer_id, can_edit=False),
            owner_user,
        )
        assert share.user_id == viewer_id
        assert share.can_edit is False

        shared_album = await album_service.get_album_for_user(session, created.id, viewer_user)
        assert shared_album.id == created.id

        await album_service.revoke_share(session, created.id, viewer_id, owner_user)

        with pytest.raises(HTTPException) as exc:
            await album_service.get_album_for_user(session, created.id, viewer_user)
        assert exc.value.status_code == 404

        await album_service.delete_album(session, created.id, owner_user)
        assert await session.get(Album, created.id) is None

    api.run_db(_exercise)


def test_album_service_lists_media_and_downloads_in_album_order(api):
    owner = api.register_and_login("album-service-media")
    first = api.upload_media(owner["access_token"], "ordered-blue.png", (0, 0, 255))
    second = api.upload_media(owner["access_token"], "ordered-green.png", (0, 255, 0))
    api.wait_for_media_status(str(first["id"]))
    api.wait_for_media_status(str(second["id"]))

    created = api.client.post(
        "/albums",
        headers=api.auth_headers(owner["access_token"]),
        json={"name": "Ordered Album"},
    )
    assert created.status_code == 201

    album_id = uuid.UUID(created.json()["id"])
    owner_id = uuid.UUID(owner["user"]["id"])
    first_id = uuid.UUID(str(first["id"]))
    second_id = uuid.UUID(str(second["id"]))

    async def _exercise(session):
        from backend.app.models import User
        from backend.app.schemas import TagFilterMode

        owner_user = await session.get(User, owner_id)
        added = await album_service.add_media_to_album(session, album_id, [first_id, second_id], owner_user)
        assert added == 2

        listing = await album_service.list_album_media(
            session,
            album_id,
            owner_user,
            tags=None,
            exclude_tags=None,
            mode=TagFilterMode.AND,
            page=1,
            page_size=20,
        )
        assert [item.id for item in listing.items] == [first_id, second_id]

        album, rows = await album_service.get_album_download_media(session, album_id, owner_user)
        assert album.id == album_id
        assert [row.id for row in rows] == [first_id, second_id]

        await album_service.remove_media_from_album(session, album_id, first_id, owner_user)

        refreshed = await album_service.list_album_media(
            session,
            album_id,
            owner_user,
            tags="green",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            page=1,
            page_size=20,
        )
        assert [item.id for item in refreshed.items] == [second_id]

    api.run_db(_exercise)
