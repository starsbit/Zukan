from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend.app.errors.error import AppError
from backend.app.models.media import Media
from backend.app.schemas import NsfwFilter
from backend.app.services.media.query import MediaQueryService
from backend.app.utils.pagination import decode_cursor


@pytest.fixture
def service(fake_db):
    return MediaQueryService(fake_db)


def test_filter_by_trashed_state(service, media):
    media.deleted_at = None
    assert service._filter_by_trashed_state(media, True) is None

    media.deleted_at = datetime.now(timezone.utc)
    assert service._filter_by_trashed_state(media, False) is None

    assert service._filter_by_trashed_state(media, None) is media


def test_can_manage_media_for_owner_or_admin(service, user, admin_user, media):
    assert service._can_manage_media(media, user) is True
    media.uploader_id = admin_user.id
    assert service._can_manage_media(media, admin_user) is True


def test_assert_nsfw_visible_raises_for_non_admin(service, user, media):
    media.is_nsfw = True

    with pytest.raises(AppError) as exc:
        service._assert_nsfw_visible(media, user)

    assert exc.value.status_code == 403


def test_build_next_cursor_round_trips(service, media):
    media.created_at = datetime.now(timezone.utc)
    media.captured_at = None
    cursor = service._build_next_cursor([media], True, "created_at")

    assert cursor is not None
    decoded = decode_cursor(cursor, "created_at")
    assert decoded is not None
    assert decoded[1] == media.id


def test_get_sort_column_rejects_unsupported(service):
    with pytest.raises(ValueError):
        service._get_sort_column("bad_field")


def test_build_order_expressions_returns_two_terms(service):
    asc = service._build_order_expressions(Media.created_at, "asc")
    desc = service._build_order_expressions(Media.created_at, "desc")

    assert len(asc) == 2
    assert len(desc) == 2


def test_apply_state_and_nsfw_filters_rejects_only_nsfw_when_disabled(service, user):
    user.show_nsfw = False
    user.is_admin = False

    with pytest.raises(AppError) as exc:
        service._apply_state_and_nsfw_filters(service._build_base_list_stmt(), user, state="active", nsfw=NsfwFilter.ONLY)

    assert exc.value.status_code == 403
