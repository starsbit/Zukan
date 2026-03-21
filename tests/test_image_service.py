import asyncio
import io
import uuid

import pytest
from fastapi import HTTPException, UploadFile

from app.services import images as image_service
from app.schemas import ImageMetadataUpdate
from tests.api_test_support import png_bytes


def test_build_upload_response_restores_deleted_duplicate_and_queues_retag(api):
    user = api.register_and_login("image-service-user")
    uploaded = api.upload_image(user["access_token"], "restore-me.png", (0, 255, 0))
    api.wait_for_image_status(str(uploaded["id"]))
    user_id = uuid.UUID(user["user"]["id"])
    uploaded_id = uuid.UUID(str(uploaded["id"]))

    deleted = api.client.delete(f"/images/{uploaded['id']}", headers=api.auth_headers(user["access_token"]))
    assert deleted.status_code == 204

    queue = asyncio.Queue()
    image_service.set_tag_queue(queue)

    async def _exercise(session):
        from app.models import Image, User

        db_user = await session.get(User, user_id)
        upload = UploadFile(
            filename="restore-me-again.png",
            file=io.BytesIO(png_bytes((0, 255, 0))),
            headers={"content-type": "image/png"},
        )
        response = await image_service.build_upload_response(session, db_user, [upload])
        assert response.accepted == 1
        assert response.duplicates == 0
        assert response.errors == 0
        assert response.results[0].id == uploaded_id

        restored = await session.get(Image, uploaded_id)
        assert restored.deleted_at is None
        assert restored.original_filename == "restore-me-again.png"
        assert restored.tagging_status == "pending"

    api.run_db(_exercise)
    assert queue.get_nowait() == uploaded_id


def test_get_visible_image_blocks_hidden_nsfw_image(api):
    user = api.register_and_login("image-service-nsfw")
    uploaded = api.upload_image(user["access_token"], "hidden-red.png", (255, 0, 0))
    api.wait_for_image_status(str(uploaded["id"]))
    user_id = uuid.UUID(user["user"]["id"])
    uploaded_id = uuid.UUID(str(uploaded["id"]))

    async def _exercise(session):
        from app.models import User

        db_user = await session.get(User, user_id)
        await image_service.get_visible_image(session, uploaded_id, db_user)

    with pytest.raises(HTTPException) as exc:
        api.run_db(_exercise)

    assert exc.value.status_code == 403
    assert exc.value.detail == "NSFW content hidden"


def test_retag_image_queues_image_id(api):
    user = api.register_and_login("image-service-retag")
    uploaded = api.upload_image(user["access_token"], "retag-me.png", (0, 0, 255))
    api.wait_for_image_status(str(uploaded["id"]))
    user_id = uuid.UUID(user["user"]["id"])
    uploaded_id = uuid.UUID(str(uploaded["id"]))

    queue = asyncio.Queue()
    image_service.set_tag_queue(queue)

    async def _exercise(session):
        from app.models import Image, User

        db_user = await session.get(User, user_id)
        await image_service.retag_image(session, uploaded_id, db_user)

        image = await session.get(Image, uploaded_id)
        assert image.tagging_status == "pending"

    api.run_db(_exercise)
    assert queue.get_nowait() == uploaded_id


def test_image_service_listing_detail_and_favorites_flow(api):
    user = api.register_and_login("image-service-library")
    blue = api.upload_image(user["access_token"], "library-blue.png", (0, 0, 255))
    red = api.upload_image(user["access_token"], "library-red.png", (255, 0, 0))
    api.wait_for_image_status(str(blue["id"]))
    api.wait_for_image_status(str(red["id"]))

    user_id = uuid.UUID(user["user"]["id"])
    blue_id = uuid.UUID(str(blue["id"]))
    red_id = uuid.UUID(str(red["id"]))
    enabled = api.client.patch(
        "/auth/me",
        headers=api.auth_headers(user["access_token"]),
        json={"show_nsfw": True},
    )
    assert enabled.status_code == 200

    async def _exercise(session):
        from app.models import User
        from app.schemas import NsfwFilter, TagFilterMode

        db_user = await session.get(User, user_id)
        listing = await image_service.list_images(
            session,
            db_user,
            tags="sky",
            character_name="REI",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            favorited=None,
            page=1,
            page_size=20,
        )
        assert [item.id for item in listing.items] == [blue_id]
        assert listing.items[0].character_name == "ayanami_rei"

        character_only = await image_service.list_images(
            session,
            db_user,
            tags=None,
            character_name="yAnAmI",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            favorited=None,
            page=1,
            page_size=20,
        )
        assert [item.id for item in character_only.items] == [blue_id]

        detail = await image_service.get_image_detail(session, blue_id, db_user)
        assert detail.id == blue_id
        assert detail.character_name == "ayanami_rei"
        assert detail.tag_details[0].name == "rating:general"

        visible = await image_service.get_visible_image(session, blue_id, db_user)
        assert visible.id == blue_id

        await image_service.favorite_image(session, blue_id, db_user)
        favorites = await image_service.list_favorites(
            session,
            db_user,
            tags="sky",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            page=1,
            page_size=20,
        )
        assert [item.id for item in favorites.items] == [blue_id]

        downloadable = await image_service.get_downloadable_images(session, db_user, [blue_id, red_id])
        assert {row.id for row in downloadable} == {blue_id, red_id}

        await image_service.unfavorite_image(session, blue_id, db_user)
        unfavorited = await image_service.list_favorites(
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


def test_image_service_trash_restore_on_this_day_and_purge_flow(api):
    user = api.register_and_login("image-service-lifecycle")
    kept = api.upload_image(user["access_token"], "lifecycle-green.png", (0, 255, 0))
    purged = api.upload_image(user["access_token"], "lifecycle-blue.png", (0, 0, 255))
    api.wait_for_image_status(str(kept["id"]))
    api.wait_for_image_status(str(purged["id"]))

    user_id = uuid.UUID(user["user"]["id"])
    kept_id = uuid.UUID(str(kept["id"]))
    purged_id = uuid.UUID(str(purged["id"]))

    async def _exercise(session):
        from datetime import datetime, timezone

        from app.models import Image, User

        db_user = await session.get(User, user_id)

        await image_service.soft_delete_image(session, kept_id, db_user)
        trash = await image_service.list_trash(session, db_user, page=1, page_size=20)
        assert [item.id for item in trash.items] == [kept_id]

        await image_service.restore_image(session, kept_id, db_user)
        restored = await session.get(Image, kept_id)
        restored.created_at = datetime.now(timezone.utc).replace(year=datetime.now(timezone.utc).year - 1)
        await session.commit()

        on_this_day = await image_service.on_this_day(session, db_user)
        assert any(image.id == kept_id for year in on_this_day.years for image in year.images)

        await image_service.soft_delete_image(session, kept_id, db_user)
        await image_service.empty_trash(session, db_user)
        assert await session.get(Image, kept_id) is None

        await image_service.purge_image(session, purged_id, db_user)
        assert await session.get(Image, purged_id) is None

    api.run_db(_exercise)


def test_update_image_metadata_replaces_tags_and_character_name(api):
    user = api.register_and_login("image-service-manual-edit")
    uploaded = api.upload_image(user["access_token"], "manual-edit-blue.png", (0, 0, 255))
    api.wait_for_image_status(str(uploaded["id"]))
    user_id = uuid.UUID(user["user"]["id"])
    uploaded_id = uuid.UUID(str(uploaded["id"]))

    async def _exercise(session):
        from app.models import User
        from app.schemas import NsfwFilter, TagFilterMode

        db_user = await session.get(User, user_id)
        db_user.show_nsfw = True
        await session.commit()
        updated = await image_service.update_image_metadata(
            session,
            uploaded_id,
            db_user,
            ImageMetadataUpdate(tags=["custom_tag", "rating:questionable"], character_name="ikari_shinji"),
        )
        assert updated.tags == ["custom_tag", "rating:questionable"]
        assert updated.character_name == "ikari_shinji"
        assert updated.is_nsfw is True
        assert {tag.name for tag in updated.tag_details} == {"custom_tag", "rating:questionable"}

        by_new_tag = await image_service.list_images(
            session,
            db_user,
            tags="custom_tag",
            character_name="shinji",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            favorited=None,
            page=1,
            page_size=20,
        )
        assert [item.id for item in by_new_tag.items] == [uploaded_id]

        by_old_tag = await image_service.list_images(
            session,
            db_user,
            tags="sky",
            character_name=None,
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            favorited=None,
            page=1,
            page_size=20,
        )
        assert by_old_tag.items == []

        cleared = await image_service.update_image_metadata(
            session,
            uploaded_id,
            db_user,
            ImageMetadataUpdate(character_name=""),
        )
        assert cleared.character_name is None

    api.run_db(_exercise)
