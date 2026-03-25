from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.albums import Album, AlbumShareRole
from backend.app.schemas import AlbumOwnershipTransferRequest, AlbumShareCreate, AlbumUpdate
from backend.app.services.albums import AlbumService
from backend.tests.services.conftest import RowResult, ScalarResult


@pytest.mark.asyncio
async def test_get_album_for_user_checks_share_permissions(fake_db, user):
    service = AlbumService(fake_db)
    album = Album(owner_id=uuid.uuid4(), name="x")
    album.id = uuid.uuid4()

    with patch.object(service, "get_album", AsyncMock(return_value=album)), patch(
        "backend.app.services.albums.AlbumRepository"
    ) as repo_cls:
        repo_cls.return_value.get_share = AsyncMock(return_value=None)
        with pytest.raises(AppError) as exc:
            await service.get_album_for_user(album.id, user)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_create_album_commits_and_returns_read(fake_db, user):
    service = AlbumService(fake_db)
    now = datetime.now(timezone.utc)

    with patch.object(service, "album_read", AsyncMock(return_value="ok")) as album_read:
        created = await service.create_album(user, "name", "desc")

    assert created == "ok"
    assert isinstance(fake_db.added[0], Album)
    fake_db.commit.assert_awaited_once()
    assert album_read.await_count == 1


@pytest.mark.asyncio
async def test_list_albums_builds_cursor_response(fake_db, user):
    service = AlbumService(fake_db)
    a1 = Album(owner_id=user.id, name="a")
    a2 = Album(owner_id=user.id, name="b")
    a3 = Album(owner_id=user.id, name="c")
    now = datetime.now(timezone.utc)
    for a in (a1, a2, a3):
        a.id = uuid.uuid4()
        a.created_at = now
        a.updated_at = now
        a.version = 1

    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[a1, a2, a3]))

    with patch("backend.app.services.albums.AlbumRepository") as repo_cls, patch.object(
        service,
        "album_read",
        AsyncMock(
            side_effect=[
                {
                    "id": a1.id,
                    "owner_id": a1.owner_id,
                    "name": a1.name,
                    "description": None,
                    "cover_media_id": None,
                    "media_count": 0,
                    "version": 1,
                    "created_at": a1.created_at,
                    "updated_at": a1.updated_at,
                },
                {
                    "id": a2.id,
                    "owner_id": a2.owner_id,
                    "name": a2.name,
                    "description": None,
                    "cover_media_id": None,
                    "media_count": 0,
                    "version": 1,
                    "created_at": a2.created_at,
                    "updated_at": a2.updated_at,
                },
            ]
        ),
    ):
        repo = repo_cls.return_value
        repo.accessible_stmt = lambda *_: SimpleNamespace(order_by=lambda *a, **k: SimpleNamespace(limit=lambda *_: None))
        repo.count_accessible = AsyncMock(return_value=3)

        # reuse fake execute result by bypassing SQL generation path
        page = await service.list_albums(user, page_size=2)

    assert page.total == 3
    assert page.has_more is True
    assert len(page.items) == 2


@pytest.mark.asyncio
async def test_update_album_rejects_version_conflict(fake_db, user):
    service = AlbumService(fake_db)
    album = Album(owner_id=user.id, name="x")
    album.id = uuid.uuid4()
    album.version = 3

    with patch.object(service, "get_album_for_user", AsyncMock(return_value=album)):
        with pytest.raises(AppError) as exc:
            await service.update_album(album.id, AlbumUpdate(version=1), user)

    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_update_album_cover_media_must_exist(fake_db, user):
    service = AlbumService(fake_db)
    album = Album(owner_id=user.id, name="x")
    album.id = uuid.uuid4()
    album.version = 1
    media_id = uuid.uuid4()

    with patch.object(service, "get_album_for_user", AsyncMock(return_value=album)), patch(
        "backend.app.services.albums.AlbumRepository"
    ) as repo_cls:
        repo_cls.return_value.get_album_media_item = AsyncMock(return_value=None)

        with pytest.raises(AppError) as exc:
            await service.update_album(album.id, AlbumUpdate(cover_media_id=media_id, version=1), user)

    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_transfer_album_ownership_happy_path(fake_db, user):
    service = AlbumService(fake_db)
    album = Album(owner_id=user.id, name="x")
    album.id = uuid.uuid4()
    old_owner = user.id
    new_owner = uuid.uuid4()

    incoming_share = SimpleNamespace(role=AlbumShareRole.editor)

    with patch.object(service, "get_album", AsyncMock(return_value=album)), patch(
        "backend.app.services.albums.AlbumRepository"
    ) as repo_cls, patch.object(service, "album_read", AsyncMock(return_value="read")):
        repo = repo_cls.return_value
        repo.get_share = AsyncMock(side_effect=[incoming_share, None])

        result = await service.transfer_album_ownership(
            album.id,
            AlbumOwnershipTransferRequest(new_owner_user_id=new_owner, keep_editor_access=True),
            user,
        )

    assert result == "read"
    assert album.owner_id == new_owner
    assert fake_db.commit.await_count == 1


@pytest.mark.asyncio
async def test_share_and_revoke_album_permissions(fake_db, user):
    service = AlbumService(fake_db)
    album = Album(owner_id=user.id, name="x")
    album.id = uuid.uuid4()
    shared_user = uuid.uuid4()

    with patch.object(service, "get_album_for_user", AsyncMock(return_value=album)), patch(
        "backend.app.services.albums.AlbumRepository"
    ) as repo_cls:
        repo = repo_cls.return_value
        repo.get_share = AsyncMock(side_effect=[None, SimpleNamespace()])

        share, created = await service.share_album(album.id, AlbumShareCreate(user_id=shared_user, role="viewer"), user)
        assert created is True

        await service.revoke_share(album.id, shared_user, user)

    assert share.user_id == shared_user
    assert fake_db.commit.await_count >= 2


@pytest.mark.asyncio
async def test_bulk_add_and_remove_from_album(fake_db, user):
    service = AlbumService(fake_db)
    album = Album(owner_id=user.id, name="x")
    album.id = uuid.uuid4()
    media_ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]

    with patch.object(service, "get_album_for_edit", AsyncMock(return_value=album)), patch(
        "backend.app.services.albums.AlbumRepository"
    ) as repo_cls, patch("backend.app.services.albums.MediaRepository") as media_repo_cls, patch.object(
        service, "ensure_cover_media", AsyncMock()
    ):
        repo = repo_cls.return_value
        repo.get_max_position = AsyncMock(return_value=0)
        repo.get_existing_media_ids = AsyncMock(return_value={media_ids[0]})
        repo.get_album_media_items = AsyncMock(return_value=[SimpleNamespace(media_id=media_ids[1])])
        media_repo_cls.return_value.get_active_ids = AsyncMock(return_value={media_ids[1], media_ids[2]})

        add_result = await service.bulk_add_to_album(album.id, media_ids, user)
        remove_result = await service.bulk_remove_from_album(album.id, media_ids, user)

    assert add_result.processed == 2
    assert remove_result.processed == 1


@pytest.mark.asyncio
async def test_get_album_and_edit_permissions(fake_db, user):
    service = AlbumService(fake_db)
    album_id = uuid.uuid4()
    album = Album(owner_id=uuid.uuid4(), name="x")
    album.id = album_id

    with patch("backend.app.services.albums.AlbumRepository") as repo_cls:
        repo = repo_cls.return_value
        repo.get_by_id = AsyncMock(return_value=None)
        with pytest.raises(AppError):
            await service.get_album(album_id)

        repo.get_by_id = AsyncMock(return_value=album)
        repo.get_share = AsyncMock(return_value=SimpleNamespace(role="viewer"))
        with pytest.raises(AppError):
            await service.get_album_for_edit(album_id, user)


@pytest.mark.asyncio
async def test_update_delete_remove_and_cover_behaviors(fake_db, user):
    service = AlbumService(fake_db)
    album = Album(owner_id=user.id, name="old")
    album.id = uuid.uuid4()
    album.version = 1
    media_id = uuid.uuid4()

    with patch.object(service, "get_album_for_user", AsyncMock(return_value=album)), patch(
        "backend.app.services.albums.AlbumRepository"
    ) as repo_cls, patch.object(service, "album_read", AsyncMock(return_value={
        "id": album.id,
        "owner_id": album.owner_id,
        "name": "new",
        "description": "d",
        "cover_media_id": media_id,
        "media_count": 1,
        "version": 1,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    })):
        repo_cls.return_value.get_album_media_item = AsyncMock(return_value=SimpleNamespace())
        result = await service.update_album(album.id, AlbumUpdate(name="new", description="d", cover_media_id=media_id, version=1), user)

    assert result["name"] == "new"

    with patch.object(service, "get_album", AsyncMock(return_value=album)):
        await service.delete_album(album.id, user)
    assert album in fake_db.deleted

    with patch.object(service, "get_album_for_user", AsyncMock(return_value=album)), patch(
        "backend.app.services.albums.AlbumRepository"
    ) as repo_cls:
        repo_cls.return_value.get_album_media_item = AsyncMock(return_value=None)
        with pytest.raises(AppError):
            await service.remove_media_from_album(album.id, media_id, user)

    album.cover_media_id = None
    with patch("backend.app.services.albums.AlbumRepository") as repo_cls:
        repo_cls.return_value.get_first_media_id = AsyncMock(return_value=media_id)
        await service.ensure_cover_media(album)
    assert album.cover_media_id == media_id


@pytest.mark.asyncio
async def test_list_album_media_and_add_remove_paths(fake_db, user):
    service = AlbumService(fake_db)
    album_id = uuid.uuid4()
    media_id = uuid.uuid4()

    m1 = SimpleNamespace(id=media_id)
    m2 = SimpleNamespace(id=uuid.uuid4())
    count_result = ScalarResult(one=2)
    rows_result = RowResult(rows=[(m1, 1), (m2, 2)])
    fake_db.execute = AsyncMock(side_effect=[count_result, rows_result])

    with patch.object(service, "get_album_for_user", AsyncMock()), patch(
        "backend.app.services.albums.media_filters.apply_tag_filters", side_effect=lambda stmt, *a: stmt
    ), patch(
        "backend.app.services.albums.UserFavoriteRepository"
    ) as fav_repo_cls, patch("backend.app.services.albums.enrich_media", return_value=[]):
        fav_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        page = await service.list_album_media(album_id, user, tags=None, exclude_tags=None, mode="and", after=None, page_size=1)

    assert page.total == 2

    album = Album(owner_id=user.id, name="a")
    album.id = album_id
    with patch.object(service, "get_album_for_user", AsyncMock(return_value=album)), patch(
        "backend.app.services.albums.AlbumRepository"
    ) as repo_cls, patch("backend.app.services.albums.MediaRepository") as media_repo_cls, patch.object(
        service, "ensure_cover_media", AsyncMock()
    ):
        repo = repo_cls.return_value
        repo.get_max_position = AsyncMock(return_value=0)
        repo.get_existing_media_ids = AsyncMock(return_value=set())
        media_repo = media_repo_cls.return_value
        media_repo.get_by_id = AsyncMock(return_value=SimpleNamespace(id=media_id, deleted_at=None))
        added = await service.add_media_to_album(album_id, [media_id], user)

    assert added == 1


@pytest.mark.asyncio
async def test_transfer_share_revoke_download_error_paths(fake_db, user):
    service = AlbumService(fake_db)
    album = Album(owner_id=user.id, name="a")
    album.id = uuid.uuid4()

    with patch.object(service, "get_album", AsyncMock(return_value=album)):
        with pytest.raises(AppError):
            await service.transfer_album_ownership(
                album.id,
                AlbumOwnershipTransferRequest(new_owner_user_id=user.id, keep_editor_access=False),
                user,
            )

    with patch.object(service, "get_album_for_user", AsyncMock(return_value=album)):
        with pytest.raises(AppError):
            await service.share_album(album.id, AlbumShareCreate(user_id=user.id, role="viewer"), user)

    with patch.object(service, "get_album_for_user", AsyncMock(return_value=album)), patch(
        "backend.app.services.albums.AlbumRepository"
    ) as repo_cls:
        repo_cls.return_value.get_share = AsyncMock(return_value=None)
        with pytest.raises(AppError):
            await service.revoke_share(album.id, uuid.uuid4(), user)

    with patch.object(service, "get_album_for_user", AsyncMock(return_value=album)), patch(
        "backend.app.services.albums.AlbumRepository"
    ) as repo_cls:
        repo_cls.return_value.get_media_for_download = AsyncMock(return_value=[])
        with pytest.raises(AppError):
            await service.get_album_download_media(album.id, user)
