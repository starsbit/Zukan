from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
import logging
from pathlib import Path
import re
from typing import Any

import httpx
from PIL import Image as PILImage
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config import settings
from backend.app.models.auth import User
from backend.app.models.integrations import IntegrationService, UserIntegration
from backend.app.models.media import Media, MediaVisibility
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus, ProcessingStep
from backend.app.models.relations import MediaEntity, MediaEntityType, MediaExternalRef
from backend.app.repositories.integrations import UserIntegrationRepository
from backend.app.repositories.media import MediaRepository
from backend.app.repositories.relations import MediaExternalRefRepository
from backend.app.repositories.tags import TagRepository
from backend.app.services.anilist import AniListCharacter, AniListSeries, fetch_series_characters, fetch_user_anime_series
from backend.app.services.media.query import MediaQueryService
from backend.app.services.media.upload import MediaPostProcessor, MediaUploadWorkflow
from backend.app.services.notifications import NotificationService
from backend.app.utils.storage import delete_media_files, save_bytes
from backend.app.utils.tagging import tag_names_mark_nsfw

logger = logging.getLogger(__name__)

_DANBOORU_POSTS_URL = "https://danbooru.donmai.us/posts.json"
_DANBOORU_PROVIDER = "danbooru"
_ANILIST_PROVIDER = "anilist"
_DEFAULT_RATING_CONFIDENCE = 1.0

_NON_TAG_CHARS_RE = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class DanbooruPost:
    post_id: int
    file_url: str
    source_url: str | None
    created_at: datetime | None
    tags_by_category: dict[int, list[str]]

    @property
    def external_id(self) -> str:
        return str(self.post_id)

    @property
    def all_tags(self) -> list[str]:
        ordered: list[str] = []
        for category in (1, 3, 4, 5, 9, 0):
            ordered.extend(self.tags_by_category.get(category, []))
        return ordered


@dataclass(frozen=True)
class AniListCharacterTarget:
    series: AniListSeries
    character: AniListCharacter

    @property
    def source_filename(self) -> str:
        return f"{self.character.preferred_name} ({self.series.preferred_title})"


class DanbooruClient:
    async def search_posts(self, target: AniListCharacterTarget) -> list[DanbooruPost]:
        series_candidates = build_danbooru_copyright_candidates(target.series.titles)
        character_candidates = build_danbooru_character_candidates(target.character.names)
        if not series_candidates or not character_candidates:
            return []

        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
            for series_candidate in series_candidates:
                for character_candidate in character_candidates:
                    response = await client.get(
                        _DANBOORU_POSTS_URL,
                        params={
                            "limit": settings.anilist_sync_search_limit,
                            "tags": f"{series_candidate} {character_candidate} order:score",
                        },
                    )
                    response.raise_for_status()
                    posts = [
                        parse_danbooru_post(payload)
                        for payload in response.json()
                    ]
                    matched = [
                        post for post in posts
                        if post is not None
                        and series_candidate in {tag.casefold() for tag in post.tags_by_category.get(3, [])}
                        and character_candidate in {tag.casefold() for tag in post.tags_by_category.get(4, [])}
                    ]
                    if matched:
                        return matched
        return []

    async def download_post(self, post: DanbooruPost) -> tuple[bytes, str] | None:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0), follow_redirects=True) as client:
            response = await client.get(post.file_url)
            response.raise_for_status()
            content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
            if not content_type:
                return None
            return response.content, content_type


class AniListSyncService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._query = MediaQueryService(db)
        self._tags = TagRepository(db)
        self._media_repo = MediaRepository(db)
        self._external_refs = MediaExternalRefRepository(db)
        self._post_processor = MediaPostProcessor(processing=None)  # not used for Danbooru imports
        self._anilist_repo = UserIntegrationRepository(db)
        self._danbooru = DanbooruClient()
        self._notifications = NotificationService(db)

    async def sync_all_linked_users(self) -> int:
        integrations = await self._anilist_repo.list_by_service(IntegrationService.anilist)
        synced = 0
        for integration in integrations:
            if integration.user is None:
                continue
            try:
                await self.sync_user(integration)
                synced += 1
            except Exception:
                logger.exception("AniList daily sync failed for user_id=%s", integration.user_id)
                await self._db.rollback()
        return synced

    async def sync_user(self, integration: UserIntegration) -> ImportBatch:
        user = integration.user
        assert user is not None

        batch = ImportBatch(
            user_id=user.id,
            type=BatchType.anilist_sync,
            status=BatchStatus.running,
            total_items=0,
            started_at=datetime.now(UTC),
            last_heartbeat_at=datetime.now(UTC),
        )
        self._db.add(batch)
        await self._db.flush()

        character_targets = await self._build_character_targets(integration.token)
        batch.total_items = len(character_targets)
        imported_characters = 0
        imported_media = 0

        for target in character_targets:
            item = ImportBatchItem(
                batch_id=batch.id,
                source_filename=target.source_filename,
                status=ItemStatus.processing,
                step=ProcessingStep.ingest,
                progress_percent=0,
            )
            self._db.add(item)
            await self._db.flush()
            try:
                imported_ids = await self._import_character_for_user(user, target)
                item.media_id = imported_ids[0] if imported_ids else None
                item.status = ItemStatus.done if imported_ids else ItemStatus.skipped
                item.progress_percent = 100
                item.error = None if imported_ids else "No new Danbooru images imported"
                if imported_ids:
                    imported_characters += 1
                    imported_media += len(imported_ids)
                    await self._publish_character_import_notification(user, target, imported_ids)
            except Exception as exc:
                item.status = ItemStatus.failed
                item.progress_percent = 100
                item.error = f"{exc.__class__.__name__}: {str(exc).strip() or exc.__class__.__name__}"[:1024]
                logger.exception("AniList sync character import failed for user_id=%s target=%s", user.id, target.source_filename)
            batch.last_heartbeat_at = datetime.now(UTC)
            await self._db.commit()

        await self._finalize_batch(batch)
        await self._db.commit()
        await self._publish_sync_summary_notification(user, batch, imported_characters, imported_media)
        return batch

    async def _build_character_targets(self, token: str) -> list[AniListCharacterTarget]:
        targets: list[AniListCharacterTarget] = []
        seen: set[tuple[int, int]] = set()
        for series in await fetch_user_anime_series(token=token):
            characters = await fetch_series_characters(media_id=series.media_id, token=token)
            for character in characters:
                key = (series.media_id, character.character_id)
                if key in seen:
                    continue
                seen.add(key)
                targets.append(AniListCharacterTarget(series=series, character=character))
        return targets

    async def _finalize_batch(self, batch: ImportBatch) -> None:
        statuses = await self._query.get_import_batch_statuses(batch.id)
        batch.total_items = len(statuses)
        batch.queued_items = sum(1 for status in statuses if status == ItemStatus.pending)
        batch.processing_items = sum(1 for status in statuses if status == ItemStatus.processing)
        batch.done_items = sum(1 for status in statuses if status in {ItemStatus.done, ItemStatus.skipped})
        batch.failed_items = sum(1 for status in statuses if status == ItemStatus.failed)
        batch.last_heartbeat_at = datetime.now(UTC)
        if batch.processing_items or batch.queued_items:
            batch.status = BatchStatus.running
            batch.finished_at = None
            return
        if batch.failed_items == batch.total_items and batch.total_items > 0:
            batch.status = BatchStatus.failed
        elif batch.failed_items > 0:
            batch.status = BatchStatus.partial_failed
        else:
            batch.status = BatchStatus.done
        batch.finished_at = datetime.now(UTC)

    async def _import_character_for_user(self, user: User, target: AniListCharacterTarget) -> list[Any]:
        posts = await self._danbooru.search_posts(target)
        imported_ids: list[Any] = []
        for post in posts:
            if len(imported_ids) >= settings.anilist_sync_per_series_limit:
                break
            if await self._external_refs.get_for_user_by_provider_and_external_id(
                user_id=user.id,
                provider=_DANBOORU_PROVIDER,
                external_id=post.external_id,
            ):
                continue
            media = await self._import_post(user, target, post)
            if media is not None:
                imported_ids.append(media.id)
        return imported_ids

    async def _import_post(self, user: User, target: AniListCharacterTarget, post: DanbooruPost) -> Media | None:
        downloaded = await self._danbooru.download_post(post)
        if downloaded is None:
            return None
        content, content_type = downloaded
        saved = await save_bytes(content, content_type)
        if saved is None:
            return None

        existing = await self._query.get_media_by_sha256(saved.sha256)
        if existing is not None:
            delete_media_files(str(saved.path))
            return None

        phash = compute_media_phash(saved.path)
        if phash and await self._media_repo.find_by_phash(phash):
            delete_media_files(str(saved.path))
            return None

        workflow = MediaUploadWorkflow(
            db=self._db,
            query=self._query,
            tags_repo=self._tags,
            post_processor=self._post_processor,
        )
        visibility = parse_import_visibility(user.anilist_import_visibility)
        media = await workflow.create_media_from_saved_upload(
            user=user,
            original_name=Path(post.file_url).name or f"danbooru-{post.post_id}",
            saved=saved,
            captured_at=post.created_at or datetime.now(UTC),
            visibility=visibility,
            tags=post.all_tags,
        )
        media.phash = phash
        media.tagging_status = "done"
        media.tagging_error = None
        media.is_nsfw = tag_names_mark_nsfw(post.all_tags)

        await self._tags.set_media_tag_links(
            media,
            build_danbooru_tag_payloads(post),
            source="imported",
            model_version="danbooru",
        )
        attach_danbooru_entities(self._db, media.id, post)
        self._db.add(MediaExternalRef(
            media_id=media.id,
            provider=_DANBOORU_PROVIDER,
            external_id=post.external_id,
            url=f"https://danbooru.donmai.us/posts/{post.post_id}",
        ))
        self._db.add(MediaExternalRef(
            media_id=media.id,
            provider=_ANILIST_PROVIDER,
            external_id=str(target.series.media_id),
            url=f"https://anilist.co/anime/{target.series.media_id}",
        ))
        return media

    async def _publish_character_import_notification(
        self,
        user: User,
        target: AniListCharacterTarget,
        imported_ids: list[Any],
    ) -> None:
        await self._notifications.publish_user_notification(
            user_id=user.id,
            title=f"Scraped {target.character.preferred_name}",
            body=(
                f"Imported {len(imported_ids)} image"
                f"{'' if len(imported_ids) == 1 else 's'} for {target.character.preferred_name} from {target.series.preferred_title}."
            ),
            data={
                "kind": "anilist_scrape_character",
                "series_id": target.series.media_id,
                "series_title": target.series.preferred_title,
                "character_id": target.character.character_id,
                "character_name": target.character.preferred_name,
                "imported_media_ids": [str(media_id) for media_id in imported_ids],
            },
        )

    async def _publish_sync_summary_notification(
        self,
        user: User,
        batch: ImportBatch,
        imported_characters: int,
        imported_media: int,
    ) -> None:
        await self._notifications.publish_user_notification(
            user_id=user.id,
            title="AniList scrape finished",
            body=(
                f"Imported {imported_media} image"
                f"{'' if imported_media == 1 else 's'} across {imported_characters} character"
                f"{'' if imported_characters == 1 else 's'}."
            ),
            data={
                "kind": "anilist_scrape_summary",
                "batch_id": str(batch.id),
                "imported_characters": imported_characters,
                "imported_media": imported_media,
            },
        )


async def anilist_sync_worker() -> None:
    from backend.app.database import AsyncSessionLocal

    interval = max(60, settings.anilist_sync_interval_seconds)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                synced = await AniListSyncService(db).sync_all_linked_users()
                if synced:
                    logger.info("AniList daily sync completed for %s linked users", synced)
        except Exception:
            logger.exception("AniList daily sync worker failed")
        await asyncio.sleep(interval)


def build_danbooru_copyright_candidates(titles: list[str]) -> list[str]:
    seen: set[str] = set()
    candidates: list[str] = []
    for title in titles:
        normalized = normalize_danbooru_tag(title)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        candidates.append(normalized)
    return candidates


def build_danbooru_character_candidates(names: list[str]) -> list[str]:
    seen: set[str] = set()
    candidates: list[str] = []
    for name in names:
        normalized = normalize_danbooru_tag(name)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        candidates.append(normalized)
    return candidates


def normalize_danbooru_tag(value: str) -> str:
    lowered = value.strip().casefold()
    normalized = _NON_TAG_CHARS_RE.sub("_", lowered).strip("_")
    normalized = re.sub(r"_+", "_", normalized)
    return normalized


def parse_danbooru_post(payload: dict[str, Any]) -> DanbooruPost | None:
    post_id = payload.get("id")
    file_url = payload.get("file_url")
    if not isinstance(post_id, int) or not isinstance(file_url, str) or not file_url:
        return None

    created_at = None
    created_raw = payload.get("created_at")
    if isinstance(created_raw, str):
        try:
            created_at = datetime.fromisoformat(created_raw.replace("Z", "+00:00")).astimezone(UTC)
        except ValueError:
            created_at = None

    tags_by_category = {
        0: split_danbooru_tag_string(payload.get("tag_string_general")),
        1: split_danbooru_tag_string(payload.get("tag_string_artist")),
        3: split_danbooru_tag_string(payload.get("tag_string_copyright")),
        4: split_danbooru_tag_string(payload.get("tag_string_character")),
        5: split_danbooru_tag_string(payload.get("tag_string_meta")),
        9: [f"rating:{value}" for value in split_danbooru_tag_string(payload.get("rating"))],
    }
    return DanbooruPost(
        post_id=post_id,
        file_url=file_url,
        source_url=payload.get("source") if isinstance(payload.get("source"), str) else None,
        created_at=created_at,
        tags_by_category=tags_by_category,
    )


def split_danbooru_tag_string(value: Any) -> list[str]:
    if not isinstance(value, str):
        return []
    return [item.strip() for item in value.split() if item.strip()]


def build_danbooru_tag_payloads(post: DanbooruPost) -> list[tuple[str, int, float]]:
    payloads: list[tuple[str, int, float]] = []
    for category in (0, 1, 3, 4, 5, 9):
        for tag in post.tags_by_category.get(category, []):
            payloads.append((tag, category, _DEFAULT_RATING_CONFIDENCE))
    return payloads


def attach_danbooru_entities(db: AsyncSession, media_id: Any, post: DanbooruPost) -> None:
    seen: set[tuple[str, str]] = set()
    for tag in post.tags_by_category.get(3, []):
        key = ("series", tag.casefold())
        if key in seen:
            continue
        seen.add(key)
        db.add(MediaEntity(
            media_id=media_id,
            entity_type=MediaEntityType.series,
            name=tag,
            role="primary",
            source="danbooru",
            confidence=1.0,
        ))
    for tag in post.tags_by_category.get(4, []):
        key = ("character", tag.casefold())
        if key in seen:
            continue
        seen.add(key)
        db.add(MediaEntity(
            media_id=media_id,
            entity_type=MediaEntityType.character,
            name=tag,
            role="primary",
            source="danbooru",
            confidence=1.0,
        ))


def parse_import_visibility(value: str | None) -> MediaVisibility:
    try:
        return MediaVisibility(value or MediaVisibility.private.value)
    except ValueError:
        return MediaVisibility.private


def compute_media_phash(path: Path) -> str | None:
    try:
        with PILImage.open(path) as img:
            grayscale = img.convert("L").resize((8, 8), PILImage.Resampling.LANCZOS)
            pixels = list(grayscale.tobytes())
    except Exception:
        return None

    if not pixels:
        return None
    avg = sum(pixels) / len(pixels)
    bits = "".join("1" if pixel >= avg else "0" for pixel in pixels)
    return f"{int(bits, 2):016x}"
