import asyncio
import io
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

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


def test_build_upload_response_commits_before_queueing_new_uploads(api):
    user = api.register_and_login("image-service-queue-order")
    user_id = uuid.UUID(user["user"]["id"])

    class CommitAwareQueue:
        def __init__(self, database_url: str):
            self.database_url = database_url
            self.seen_ids: list[uuid.UUID] = []

        async def put(self, media_id: uuid.UUID):
            engine = create_async_engine(self.database_url, poolclass=NullPool)
            session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            try:
                async with session_maker() as session:
                    from backend.app.models import Media

                    media = (await session.execute(select(Media).where(Media.id == media_id))).scalar_one_or_none()
                    assert media is not None, "Media was queued before it was committed"
                    self.seen_ids.append(media_id)
            finally:
                await engine.dispose()

    queue = CommitAwareQueue(api.database_url)
    media_service.set_tag_queue(queue)

    async def _exercise(session):
        from backend.app.models import User

        db_user = await session.get(User, user_id)
        upload = UploadFile(
            filename="commit-before-queue.png",
            file=io.BytesIO(png_bytes((0, 0, 255))),
            headers={"content-type": "image/png"},
        )
        response = await media_service.build_upload_response(session, db_user, [upload])
        assert response.accepted == 1

    api.run_db(_exercise)
    assert len(queue.seen_ids) == 1


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
    assert exc.value.detail["code"] == "nsfw_hidden"


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


def test_tag_media_retries_transient_predict_failures(api, monkeypatch):
    user = api.register_and_login("image-service-retry")
    user_id = uuid.UUID(user["user"]["id"])

    queue = asyncio.Queue()
    media_service.set_tag_queue(queue)
    attempts = {"count": 0}

    async def flaky_predict(_image_path: str):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise RuntimeError("temporary inference error")
        from backend.app.services.tagger import TagPrediction, TaggingResult

        return TaggingResult(
            predictions=[TagPrediction(name="sky", category=0, confidence=0.9)],
            character_name=None,
            is_nsfw=False,
        )

    monkeypatch.setattr(media_service.tagger, "predict", flaky_predict)
    monkeypatch.setattr(media_service.settings, "tagging_retry_attempts", 3)
    monkeypatch.setattr(media_service.settings, "tagging_retry_backoff_seconds", 0.0)

    async def _exercise(session):
        from backend.app.models import Media, User

        db_user = await session.get(User, user_id)
        upload = UploadFile(
            filename="retry-me.png",
            file=io.BytesIO(png_bytes((0, 0, 255))),
            headers={"content-type": "image/png"},
        )
        response = await media_service.build_upload_response(session, db_user, [upload])
        media_id = response.results[0].id

        await media_service.tag_media(session, media_id)

        media = await session.get(Media, media_id)
        assert media.tagging_status == "done"
        assert media.tagging_error is None
        assert media.tags == ["sky"]

    api.run_db(_exercise)
    assert attempts["count"] == 3


def test_tag_media_filters_persisted_tags_by_user_confidence_threshold(api, monkeypatch):
    user = api.register_and_login("image-service-threshold")
    user_id = uuid.UUID(user["user"]["id"])

    async def fake_predict(_image_path: str):
        from backend.app.services.tagger import TagPrediction, TaggingResult

        return TaggingResult(
            predictions=[
                TagPrediction(name="sky", category=0, confidence=0.91),
                TagPrediction(name="blue", category=0, confidence=0.68),
                TagPrediction(name="heroine_a", category=4, confidence=0.74),
                TagPrediction(name="rating:general", category=9, confidence=0.99),
            ],
            character_name="heroine_a",
            is_nsfw=False,
        )

    monkeypatch.setattr(media_service.tagger, "predict", fake_predict)

    async def _exercise(session):
        from backend.app.models import Media, User

        db_user = await session.get(User, user_id)
        db_user.tag_confidence_threshold = 0.75
        await session.commit()

        upload = UploadFile(
            filename="threshold-me.png",
            file=io.BytesIO(png_bytes((0, 0, 255))),
            headers={"content-type": "image/png"},
        )
        response = await media_service.build_upload_response(session, db_user, [upload])
        media_id = response.results[0].id

        await media_service.tag_media(session, media_id)

        media = await session.get(Media, media_id)
        assert media.tags == ["rating:general", "sky"]
        assert media.character_name is None

    api.run_db(_exercise)


def test_mark_tagging_failure_persists_error_and_retag_clears_it(api):
    user = api.register_and_login("image-service-tagging-error")
    uploaded = api.upload_media(user["access_token"], "tagging-error.png", (0, 0, 255))
    api.wait_for_media_status(str(uploaded["id"]))
    user_id = uuid.UUID(user["user"]["id"])
    uploaded_id = uuid.UUID(str(uploaded["id"]))

    queue = asyncio.Queue()
    media_service.set_tag_queue(queue)

    async def _exercise(session):
        from backend.app.models import Media, User

        db_user = await session.get(User, user_id)
        await media_service.mark_tagging_failure(session, uploaded_id, RuntimeError("model offline"))

        failed_media = await session.get(Media, uploaded_id)
        assert failed_media.tagging_status == "failed"
        assert failed_media.tagging_error == "RuntimeError: model offline"

        failed_detail = await media_service.get_media_detail(session, uploaded_id, db_user)
        assert failed_detail.tagging_error == "RuntimeError: model offline"

        await media_service.retag_media(session, uploaded_id, db_user)
        retried_media = await session.get(Media, uploaded_id)
        assert retried_media.tagging_status == "pending"
        assert retried_media.tagging_error is None

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
            tags=["sky"],
            character_name="REI",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            metadata=MediaMetadataFilter(),
            favorited=None,
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
            page_size=20,
        )
        assert [item.id for item in character_only.items] == [blue_id]

        normalized_character_only = await media_service.list_media(
            session,
            db_user,
            MediaListState.ACTIVE,
            tags=None,
            character_name="sumika_muvluv",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            metadata=MediaMetadataFilter(),
            favorited=None,
            page_size=20,
        )
        assert normalized_character_only.items == []

        await media_service.update_media_metadata(
            session,
            blue_id,
            db_user,
            MediaUpdate(character_name="Sumika (Muvluv)"),
        )

        created_album = api.client.post(
            "/albums",
            headers=api.auth_headers(user["access_token"]),
            json={"name": "Service Album"},
        )
        assert created_album.status_code == 201
        album_id = uuid.UUID(created_album.json()["id"])

        add_to_album = api.client.put(
            f"/albums/{album_id}/media",
            headers=api.auth_headers(user["access_token"]),
            json={"media_ids": [str(blue_id)]},
        )
        assert add_to_album.status_code == 200

        normalized_sumika = await media_service.list_media(
            session,
            db_user,
            MediaListState.ACTIVE,
            tags=None,
            character_name="sumika_muvluv",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            metadata=MediaMetadataFilter(),
            favorited=None,
            page_size=20,
        )
        assert [item.id for item in normalized_sumika.items] == [blue_id]

        album_filtered = await media_service.list_media(
            session,
            db_user,
            MediaListState.ACTIVE,
            tags=["sky"],
            character_name=None,
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            metadata=MediaMetadataFilter(),
            favorited=None,
            album_id=album_id,
            page_size=20,
        )
        assert [item.id for item in album_filtered.items] == [blue_id]

        detail = await media_service.get_media_detail(session, blue_id, db_user)
        assert detail.id == blue_id
        assert detail.character_name == "Sumika (Muvluv)"
        assert detail.tag_details[0].name == "rating:general"

        visible = await media_service.get_visible_media(session, blue_id, db_user)
        assert visible.id == blue_id

        await media_service.favorite_media(session, blue_id, db_user)
        favorites = await media_service.list_favorites(
            session,
            db_user,
            tags=["sky"],
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
        trash = await media_service.list_trash(session, db_user, after=None, page_size=20)
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
            page_size=20,
        )
        assert [item.id for item in on_this_day.items] == [kept_id]

        await media_service.soft_delete_media(session, kept_id, db_user)
        await media_service.empty_trash(session, db_user)
        assert await session.get(Media, kept_id) is None

        await media_service.purge_media(session, purged_id, db_user)
        assert await session.get(Media, purged_id) is None

    api.run_db(_exercise)


def test_list_trash_auto_purges_items_older_than_thirty_days(api):
    user = api.register_and_login("image-service-trash-retention")
    fresh = api.upload_media(user["access_token"], "fresh-trash.png", (0, 255, 0))
    expired = api.upload_media(user["access_token"], "expired-trash.png", (0, 0, 255))
    api.wait_for_media_status(str(fresh["id"]))
    api.wait_for_media_status(str(expired["id"]))

    user_id = uuid.UUID(user["user"]["id"])
    fresh_id = uuid.UUID(str(fresh["id"]))
    expired_id = uuid.UUID(str(expired["id"]))

    async def _exercise(session):
        from backend.app.models import Media, User

        db_user = await session.get(User, user_id)
        await media_service.soft_delete_media(session, fresh_id, db_user)
        await media_service.soft_delete_media(session, expired_id, db_user)

        fresh_media = await session.get(Media, fresh_id)
        expired_media = await session.get(Media, expired_id)
        now = datetime.now(timezone.utc)
        fresh_media.deleted_at = now - timedelta(days=29)
        expired_media.deleted_at = now - timedelta(days=31)
        await session.commit()

        trashed = await media_service.list_trash(session, db_user, after=None, page_size=20)
        assert [item.id for item in trashed.items] == [fresh_id]
        assert await session.get(Media, fresh_id) is not None
        assert await session.get(Media, expired_id) is None

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
            tags=["custom_tag"],
            character_name="shinji",
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            metadata=MediaMetadataFilter(),
            favorited=None,
            page_size=20,
        )
        assert [item.id for item in by_new_tag.items] == [uploaded_id]

        by_old_tag = await media_service.list_media(
            session,
            db_user,
            MediaListState.ACTIVE,
            tags=["sky"],
            character_name=None,
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter="done",
            metadata=MediaMetadataFilter(),
            favorited=None,
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


def test_manual_retag_and_purge_cleanup_remove_dangling_tag_rows(api, monkeypatch):
    user = api.register_and_login("image-service-tag-cleanup")
    uploaded = api.upload_media(user["access_token"], "cleanup-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(uploaded["id"]))
    user_id = uuid.UUID(user["user"]["id"])
    uploaded_id = uuid.UUID(str(uploaded["id"]))

    async def fake_predict(_image_path: str):
        from backend.app.services.tagger import TagPrediction, TaggingResult

        return TaggingResult(
            predictions=[
                TagPrediction(name="forest", category=0, confidence=0.95),
                TagPrediction(name="green", category=0, confidence=0.9),
                TagPrediction(name="rating:general", category=9, confidence=0.99),
            ],
            character_name=None,
            is_nsfw=False,
        )

    monkeypatch.setattr(media_service.tagger, "predict", fake_predict)

    async def _exercise(session):
        from backend.app.models import User

        db_user = await session.get(User, user_id)
        await media_service.update_media_metadata(
            session,
            uploaded_id,
            db_user,
            MediaUpdate(tags=["custom_tag", "rating:general"]),
        )
        assert (await session.execute(select(media_service.Tag).where(media_service.Tag.name == "sky"))).scalar_one_or_none() is None
        assert (await session.execute(select(media_service.Tag).where(media_service.Tag.name == "custom_tag"))).scalar_one_or_none() is not None

        await media_service.tag_media(session, uploaded_id)
        assert (await session.execute(select(media_service.Tag).where(media_service.Tag.name == "custom_tag"))).scalar_one_or_none() is None
        assert (await session.execute(select(media_service.Tag).where(media_service.Tag.name == "forest"))).scalar_one_or_none() is not None

        media = await session.get(media_service.Media, uploaded_id)
        await media_service.purge_media_record(media, session)
        await session.commit()

        assert (await session.execute(select(media_service.Tag).where(media_service.Tag.name == "forest"))).scalar_one_or_none() is None
        assert (await session.execute(select(media_service.Tag).where(media_service.Tag.name == "green"))).scalar_one_or_none() is None
        assert (await session.execute(select(media_service.Tag).where(media_service.Tag.name == "rating:general"))).scalar_one_or_none() is None

    api.run_db(_exercise)


def test_ocr_text_can_be_set_queried_and_searched(api):
    user = api.register_and_login("image-service-ocr")
    blue = api.upload_media(user["access_token"], "ocr-blue.png", (0, 0, 255))
    green = api.upload_media(user["access_token"], "ocr-green.png", (0, 255, 0))
    api.wait_for_media_status(str(blue["id"]))
    api.wait_for_media_status(str(green["id"]))
    blue_id = uuid.UUID(str(blue["id"]))
    green_id = uuid.UUID(str(green["id"]))
    user_id = uuid.UUID(user["user"]["id"])

    async def _exercise(session):
        from backend.app.models import User
        from backend.app.schemas import MediaMetadataFilter, NsfwFilter, TagFilterMode

        db_user = await session.get(User, user_id)

        updated = await media_service.update_media_metadata(
            session,
            blue_id,
            db_user,
            MediaUpdate(ocr_text_override="Hello World from OCR"),
        )
        assert updated.ocr_text_override == "Hello World from OCR"

        refreshed = await media_service.get_media_detail(session, blue_id, db_user)
        assert refreshed.ocr_text_override == "Hello World from OCR"

        media_row = await session.get(media_service.Media, blue_id)
        assert media_row.ocr_text_override == "Hello World from OCR"

        hit = await media_service.list_media(
            session,
            db_user,
            MediaListState.ACTIVE,
            tags=None,
            character_name=None,
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter=None,
            metadata=MediaMetadataFilter(),
            favorited=None,
            page_size=20,
            ocr_text="hello world",
        )
        assert [item.id for item in hit.items] == [blue_id]

        no_match = await media_service.list_media(
            session,
            db_user,
            MediaListState.ACTIVE,
            tags=None,
            character_name=None,
            exclude_tags=None,
            mode=TagFilterMode.AND,
            nsfw=NsfwFilter.INCLUDE,
            status_filter=None,
            metadata=MediaMetadataFilter(),
            favorited=None,
            page_size=20,
            ocr_text="nonexistent phrase xyz",
        )
        assert no_match.items == []

        cleared = await media_service.update_media_metadata(
            session,
            blue_id,
            db_user,
            MediaUpdate(ocr_text_override=None),
        )
        assert cleared.ocr_text_override is None

    api.run_db(_exercise)

def test_media_list_include_total_true_returns_count(api):
    user = api.register_and_login("include-total-true-user")
    headers = api.auth_headers(user["access_token"])
    api.upload_media(user["access_token"], "total-blue.png", (0, 0, 255))

    resp = api.client.get("/media", headers=headers, params={"include_total": "true"})
    assert resp.status_code == 200
    assert resp.json()["total"] is not None
    assert resp.json()["total"] >= 1


def test_media_list_include_total_false_returns_null(api):
    user = api.register_and_login("include-total-false-user")
    headers = api.auth_headers(user["access_token"])
    api.upload_media(user["access_token"], "nototal-blue.png", (0, 0, 255))

    resp = api.client.get("/media", headers=headers, params={"include_total": "false"})
    assert resp.status_code == 200
    assert resp.json()["total"] is None
    assert "items" in resp.json()


def test_media_list_default_includes_total(api):
    user = api.register_and_login("default-total-user")
    headers = api.auth_headers(user["access_token"])

    resp = api.client.get("/media", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["total"] is not None

def test_media_list_response_has_next_cursor_field(api):
    user = api.register_and_login("cursor-shape-user")
    headers = api.auth_headers(user["access_token"])

    resp = api.client.get("/media", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert "next_cursor" in body
    assert "page_size" in body
    assert "items" in body
    assert "total" in body


def test_media_detail_has_external_refs_field(api):
    user = api.register_and_login("detail-extref-shape-user")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "detail-extref-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    detail = api.client.get(f"/media/{blue['id']}", headers=headers)
    assert detail.status_code == 200
    body = detail.json()
    assert "external_refs" in body
    assert "ocr_text_override" in body
    assert "ocr_text" in body
    assert "version" in body