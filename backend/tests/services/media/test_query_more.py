from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.processing import ItemStatus
from backend.app.schemas import MediaListState, NsfwFilter, TagFilterMode
from backend.app.services.media.query import MediaQueryService


class _ScalarListResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def all(self):
        return self._items


class _ScalarOneResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


@pytest.fixture
def service(fake_db):
    return MediaQueryService(fake_db)


@pytest.mark.asyncio
async def test_get_owned_or_admin_media_not_found_or_forbidden(service, user, media):
    service._media_repo.get_by_id = AsyncMock(return_value=media)

    with pytest.raises(AppError) as not_found:
        await service.get_owned_or_admin_media(media.id, user, trashed=True)
    assert not_found.value.status_code == 404

    media.deleted_at = None
    media.uploader_id = uuid.uuid4()
    with pytest.raises(AppError) as forbidden:
        await service.get_owned_or_admin_media(media.id, user, trashed=False)
    assert forbidden.value.status_code == 403


@pytest.mark.asyncio
async def test_get_active_media_raises_for_deleted_or_missing(service, media):
    service._media_repo.get_by_id = AsyncMock(return_value=None)
    with pytest.raises(AppError):
        await service.get_active_media(media.id)

    media.deleted_at = datetime.now(timezone.utc)
    service._media_repo.get_by_id = AsyncMock(return_value=media)
    with pytest.raises(AppError):
        await service.get_active_media(media.id)


@pytest.mark.asyncio
async def test_repo_passthrough_methods(service):
    media_id = uuid.uuid4()
    service._media_repo.get_by_id = AsyncMock(return_value="m")
    service._media_repo.get_by_sha256 = AsyncMock(return_value="s")
    service._media_repo.get_by_ids = AsyncMock(return_value=["x"])
    service._media_repo.get_by_id_with_relations = AsyncMock(return_value="r")
    service._media_repo.get_expired_trash = AsyncMock(return_value=["e"])
    service._media_repo.get_active_ids = AsyncMock(return_value={media_id})

    assert await service.get_media_by_id(media_id) == "m"
    assert await service.get_media_by_sha256("abc") == "s"
    assert await service.get_media_by_ids([media_id]) == ["x"]
    assert await service.get_media_with_relations(media_id, deleted=None) == "r"
    assert await service.get_expired_trash(datetime.now(timezone.utc)) == ["e"]
    assert await service.get_active_media_ids([media_id]) == {media_id}


@pytest.mark.asyncio
async def test_execute_based_query_helpers(service, fake_db):
    media_id = uuid.uuid4()
    fake_db.execute = AsyncMock(side_effect=[_ScalarListResult([1]), _ScalarOneResult("item"), _ScalarListResult([ItemStatus.done])])
    fake_db.get = AsyncMock(return_value="batch")

    assert await service.list_trashed_media_for_user(SimpleNamespace(is_admin=True, id=uuid.uuid4())) == [1]
    assert await service.get_upload_batch_item_for_media(media_id) == "item"
    assert await service.get_import_batch(uuid.uuid4()) == "batch"
    assert await service.get_import_batch_statuses(uuid.uuid4()) == [ItemStatus.done]


@pytest.mark.asyncio
async def test_visibility_and_detail_methods(service, user, media):
    service._media_repo.get_by_id = AsyncMock(return_value=None)
    with pytest.raises(AppError):
        await service.get_visible_media(media.id, user)

    media.is_nsfw = False
    service._media_repo.get_by_id_with_relations = AsyncMock(return_value=media)
    service.build_media_detail = AsyncMock(return_value="detail")
    detail = await service.get_media_detail(media.id, user)
    assert detail == "detail"


@pytest.mark.asyncio
async def test_list_character_suggestions_and_downloadables(service, user, media):
    service._entity_repo.list_character_suggestions = AsyncMock(return_value=[{"name": "Saber", "media_count": 3}])
    assert await service.list_character_suggestions(user, q="   ", limit=5) == []
    assert await service.list_character_suggestions(user, q=" sa ", limit=5) == [{"name": "Saber", "media_count": 3}]

    media.deleted_at = None
    media.uploader_id = user.id
    service._media_repo.get_by_ids = AsyncMock(return_value=[media])
    rows = await service.get_downloadable_media(user, [media.id])
    assert rows == [media]

    media.deleted_at = datetime.now(timezone.utc)
    with pytest.raises(AppError):
        await service.get_downloadable_media(user, [media.id])


@pytest.mark.asyncio
async def test_ensure_album_visible_requires_owner_admin_or_share(service, user):
    album = SimpleNamespace(owner_id=uuid.uuid4())
    share = None
    service._db.execute = AsyncMock(side_effect=[_ScalarOneResult(album), _ScalarOneResult(share)])

    with pytest.raises(AppError):
        await service._ensure_album_is_visible(user, uuid.uuid4())


@pytest.mark.asyncio
async def test_list_media_orchestrates_filter_pipeline(service, user):
    user.id = uuid.uuid4()
    row1 = SimpleNamespace(id=uuid.uuid4(), captured_at=datetime.now(timezone.utc), created_at=datetime.now(timezone.utc))
    row2 = SimpleNamespace(id=uuid.uuid4(), captured_at=datetime.now(timezone.utc), created_at=datetime.now(timezone.utc))
    row3 = SimpleNamespace(id=uuid.uuid4(), captured_at=datetime.now(timezone.utc), created_at=datetime.now(timezone.utc))

    service._build_base_list_stmt = lambda: "stmt0"
    service._apply_album_filter = AsyncMock(return_value="stmt1")
    service._apply_state_and_nsfw_filters = lambda stmt, *_: f"{stmt}:state"
    service._apply_status_filter = lambda stmt, *_: f"{stmt}:status"
    service._apply_favorited_filter = lambda stmt, *_: f"{stmt}:fav"
    service._count_total = AsyncMock(return_value=10)
    service._apply_cursor = lambda stmt, *_: f"{stmt}:cursor"
    service._fetch_page_rows = AsyncMock(return_value=[row1, row2, row3])
    service._favorite_repo.get_favorited_ids = AsyncMock(return_value={row1.id})

    with patch("backend.app.services.media.query.media_filters.apply_tag_filters", side_effect=lambda stmt, *a: stmt), patch(
        "backend.app.services.media.query.media_filters.apply_character_name_filter", side_effect=lambda stmt, *a: stmt
    ), patch("backend.app.services.media.query.media_filters.apply_media_type_filters", side_effect=lambda stmt, *a: stmt), patch(
        "backend.app.services.media.query.media_filters.apply_captured_at_filters", side_effect=lambda stmt, *a: stmt
    ), patch("backend.app.services.media.query.media_filters.apply_ocr_text_filter", side_effect=lambda stmt, *a: stmt), patch(
        "backend.app.services.media.query.enrich_media", return_value=[]
    ):
        page = await service.list_media(
            user=user,
            state=MediaListState.ACTIVE,
            tags=None,
            character_name=None,
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.DEFAULT,
            status_filter=None,
            metadata=SimpleNamespace(),
            favorited=None,
            page_size=2,
            include_total=True,
        )

    assert page.total == 10
    assert page.has_more is True
    assert page.next_cursor is not None
    assert page.items == []
