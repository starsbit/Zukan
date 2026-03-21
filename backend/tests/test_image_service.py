import asyncio
import io
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException, UploadFile

from backend.app.services import media as media_service
from backend.app.schemas import MediaListState, MediaUpdate
from backend.tests.api_test_support import jpeg_bytes, png_bytes


def test_build_upload_response_restores_deleted_duplicate_and_queues_retag(api):
    user = api.register_and_login("image-service-user")
    uploaded = api.upload_media(user["access_token"], "restore-me.png", (0, 255, 0))
    api.wait_for_media_status(str(uploaded["id"]))
    user_id = uuid.UUID(user["user"]["id"])
    uploaded_id = uuid.UUID(str(uploaded["id"]))

    deleted = api.client.patch(
        f"/media/{uploaded['id']}",
        headers=api.auth_headers(user["access_token"]),
        json={"deleted": True},
    )
    assert deleted.status_code == 200

    queue = asyncio.Queue()
    media_service.set_tag_queue(queue)

    async def _exercise(session):
        from backend.app.models import Media, User
        from backend.app.schemas import MediaMetadataFilter, NsfwFilter, TagFilterMode

        db_user = await session.get(User, user_id)
        upload = UploadFile(
            filename="restore-me-again.png",
            file=io.BytesIO(png_bytes((0, 255, 0))),
            headers={"content-type": "image/png"},
        )
        response = await media_service.build_upload_response(session, db_user, [upload])
        assert response.accepted == 1
        assert response.duplicates == 0
        assert response.errors == 0
        assert response.results[0].id == uploaded_id

        restored = await session.get(Media, uploaded_id)
        assert restored.deleted_at is None
        assert restored.original_filename == "restore-me-again.png"
        assert restored.tagging_status == "pending"

    api.run_db(_exercise)
    assert queue.get_nowait() == uploaded_id


def test_build_upload_response_uses_embedded_capture_timestamp(api):
    user = api.register_and_login("image-service-capture-time")
    user_id = uuid.UUID(user["user"]["id"])
    embedded_time = datetime(2018, 3, 21, 8, 15, tzinfo=timezone.utc)

    queue = asyncio.Queue()
    media_service.set_tag_queue(queue)

    async def _exercise(session):
        from backend.app.models import Media, User
        from backend.app.schemas import NsfwFilter, TagFilterMode

        db_user = await session.get(User, user_id)
        upload = UploadFile(
            filename="captured.jpg",
            file=io.BytesIO(jpeg_bytes((0, 0, 255), captured_at=embedded_time)),
            headers={"content-type": "image/jpeg"},
        )
        response = await media_service.build_upload_response(session, db_user, [upload])
        image = await session.get(Media, response.results[0].id)
        assert image.captured_at == embedded_time

    api.run_db(_exercise)


def test_get_visible_media_blocks_hidden_nsfw_media(api):
    user = api.register_and_login("image-service-nsfw")
    uploaded = api.upload_media(user["access_token"], "hidden-red.png", (255, 0, 0))
    api.wait_for_media_status(str(uploaded["id"]))
    user_id = uuid.UUID(user["user"]["id"])
    uploaded_id = uuid.UUID(str(uploaded["id"]))

    async def _exercise(session):
        from backend.app.models import User

        db_user = await session.get(User, user_id)
        await media_service.get_visible_media(session, uploaded_id, db_user)

    with pytest.raises(HTTPException) as exc:
        api.run_db(_exercise)

    assert exc.value.status_code == 403
    assert exc.value.detail == "NSFW content hidden"


def test_retag_media_queues_media_id(api):
    user = api.register_and_login("image-service-retag")
    uploaded = api.upload_media(user["access_token"], "retag-me.png", (0, 0, 255))
    api.wait_for_media_status(str(uploaded["id"]))
    user_id = uuid.UUID(user["user"]["id"])
    uploaded_id = uuid.UUID(str(uploaded["id"]))

    queue = asyncio.Queue()
    media_service.set_tag_queue(queue)

    async def _exercise(session):
        from backend.app.models import Media, User
        from backend.app.schemas import NsfwFilter, TagFilterMode

        db_user = await session.get(User, user_id)
        await media_service.retag_media(session, uploaded_id, db_user)

        media = await session.get(Media, uploaded_id)
        assert media.tagging_status == "pending"

    api.run_db(_exercise)
    assert queue.get_nowait() == uploaded_id


def test_media_service_listing_detail_and_favorites_flow(api):
    user = api.register_and_login("image-service-library")
    blue = api.upload_media(user["access_token"], "library-blue.png", (0, 0, 255))
    red = api.upload_media(user["access_token"], "library-red.png", (255, 0, 0))
    api.wait_for_media_status(str(blue["id"]))
    api.wait_for_media_status(str(red["id"]))

    user_id = uuid.UUID(user["user"]["id"])
    blue_id = uuid.UUID(str(blue["id"]))
    red_id = uuid.UUID(str(red["id"]))
    enabled = api.client.patch(
        "/users/me",
        headers=api.auth_headers(user["access_token"]),
        json={"show_nsfw": True},
    )
    assert enabled.status_code == 200

    async def _exercise(session):
        from backend.app.models import User
        from backend.app.schemas import MediaMetadataFilter, NsfwFilter, TagFilterMode

        db_user = await session.get(User, user_id)
        listing = await media_service.list_media(
            session,
            db_user,
            MediaListState.ACTIVE,
            tags="sky",
            character_name="REI",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            metadata=MediaMetadataFilter(),
            favorited=None,
            page=1,
            page_size=20,
        )
        assert [item.id for item in listing.items] == [blue_id]
        assert listing.items[0].character_name == "ayanami_rei"

        character_only = await media_service.list_media(
            session,
            db_user,
            MediaListState.ACTIVE,
            tags=None,
            character_name="yAnAmI",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            metadata=MediaMetadataFilter(),
            favorited=None,
            page=1,
            page_size=20,
        )
        assert [item.id for item in character_only.items] == [blue_id]

        detail = await media_service.get_media_detail(session, blue_id, db_user)
        assert detail.id == blue_id
        assert detail.character_name == "ayanami_rei"
        assert detail.tag_details[0].name == "rating:general"

        visible = await media_service.get_visible_media(session, blue_id, db_user)
        assert visible.id == blue_id

        await media_service.favorite_media(session, blue_id, db_user)
        favorites = await media_service.list_favorites(
            session,
            db_user,
            tags="sky",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            page=1,
            page_size=20,
        )
        assert [item.id for item in favorites.items] == [blue_id]

        downloadable = await media_service.get_downloadable_media(session, db_user, [blue_id, red_id])
        assert {row.id for row in downloadable} == {blue_id, red_id}

        await media_service.unfavorite_media(session, blue_id, db_user)
        unfavorited = await media_service.list_favorites(
            session,
            db_user,
            tags=None,
            exclude_tags=None,
            mode=TagFilterMode.AND,
            page=1,
            page_size=20,
        )
        assert unfavorited.items == []

    api.run_db(_exercise)


def test_media_service_trash_restore_on_this_day_and_purge_flow(api):
    user = api.register_and_login("image-service-lifecycle")
    kept = api.upload_media(user["access_token"], "lifecycle-green.png", (0, 255, 0))
    purged = api.upload_media(user["access_token"], "lifecycle-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(kept["id"]))
    api.wait_for_media_status(str(purged["id"]))

    user_id = uuid.UUID(user["user"]["id"])
    kept_id = uuid.UUID(str(kept["id"]))
    purged_id = uuid.UUID(str(purged["id"]))

    async def _exercise(session):
        from backend.app.models import Media, User
        from backend.app.schemas import MediaMetadataFilter, NsfwFilter, TagFilterMode

        db_user = await session.get(User, user_id)

        await media_service.soft_delete_media(session, kept_id, db_user)
        trash = await media_service.list_trash(session, db_user, page=1, page_size=20)
        assert [item.id for item in trash.items] == [kept_id]

        await media_service.restore_media(session, kept_id, db_user)
        restored = await session.get(Media, kept_id)
        restored.captured_at = datetime.now(timezone.utc).replace(year=datetime.now(timezone.utc).year - 1)
        await session.commit()

        on_this_day = await media_service.list_media(
            session,
            db_user,
            MediaListState.ACTIVE,
            tags=None,
            character_name=None,
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.DEFAULT,
            status_filter=None,
            metadata=MediaMetadataFilter(
                captured_month=restored.captured_at.month,
                captured_day=restored.captured_at.day,
                captured_before_year=datetime.now(timezone.utc).year,
            ),
            favorited=None,
            page=1,
            page_size=20,
        )
        assert [item.id for item in on_this_day.items] == [kept_id]

        await media_service.soft_delete_media(session, kept_id, db_user)
        await media_service.empty_trash(session, db_user)
        assert await session.get(Media, kept_id) is None

        await media_service.purge_media(session, purged_id, db_user)
        assert await session.get(Media, purged_id) is None

    api.run_db(_exercise)


def test_update_media_metadata_replaces_tags_and_character_name(api):
    user = api.register_and_login("image-service-manual-edit")
    uploaded = api.upload_media(user["access_token"], "manual-edit-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(uploaded["id"]))
    user_id = uuid.UUID(user["user"]["id"])
    uploaded_id = uuid.UUID(str(uploaded["id"]))

    async def _exercise(session):
        from backend.app.models import User
        from backend.app.schemas import MediaMetadataFilter, MediaMetadataUpdate, NsfwFilter, TagFilterMode

        db_user = await session.get(User, user_id)
        db_user.show_nsfw = True
        await session.commit()
        updated = await media_service.update_media_metadata(
            session,
            uploaded_id,
            db_user,
            MediaUpdate(
                tags=["custom_tag", "rating:questionable"],
                character_name="ikari_shinji",
                metadata=MediaMetadataUpdate(captured_at=datetime(2020, 3, 21, 9, 30, tzinfo=timezone.utc)),
            ),
        )
        assert updated.tags == ["custom_tag", "rating:questionable"]
        assert updated.character_name == "ikari_shinji"
        assert updated.metadata.captured_at == datetime(2020, 3, 21, 9, 30, tzinfo=timezone.utc)
        assert updated.is_nsfw is True
        assert {tag.name for tag in updated.tag_details} == {"custom_tag", "rating:questionable"}

        by_new_tag = await media_service.list_media(
            session,
            db_user,
            MediaListState.ACTIVE,
            tags="custom_tag",
            character_name="shinji",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            metadata=MediaMetadataFilter(),
            favorited=None,
            page=1,
            page_size=20,
        )
        assert [item.id for item in by_new_tag.items] == [uploaded_id]

        by_old_tag = await media_service.list_media(
            session,
            db_user,
            MediaListState.ACTIVE,
            tags="sky",
            character_name=None,
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            metadata=MediaMetadataFilter(),
            favorited=None,
            page=1,
            page_size=20,
        )
        assert by_old_tag.items == []

        cleared = await media_service.update_media_metadata(
            session,
            uploaded_id,
            db_user,
            MediaUpdate(character_name="", metadata=MediaMetadataUpdate(captured_at=None)),
        )
        assert cleared.character_name is None
        assert cleared.metadata.captured_at == cleared.created_at

    api.run_db(_exercise)
