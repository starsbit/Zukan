from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.models import Media, MediaTag, Tag, User
from backend.app.schemas import CATEGORY_NAMES, TagManagementResult, TagRead
from backend.app.services import media as media_service


def _to_tag_read(tag: Tag) -> TagRead:
    return TagRead(
        id=tag.id,
        name=tag.name,
        category=tag.category,
        category_name=CATEGORY_NAMES.get(tag.category, "unknown"),
        media_count=tag.media_count,
    )


def _accessible_media_stmt(user: User):
    stmt = select(Media)
    if not user.is_admin:
        stmt = stmt.where(Media.uploader_id == user.id)
    return stmt


async def list_tags(
    db: AsyncSession,
    *,
    limit: int,
    offset: int,
    category: int | None,
    query: str | None = None,
) -> list[TagRead]:
    stmt = select(Tag).order_by(Tag.media_count.desc()).offset(offset).limit(limit)
    if category is not None:
        stmt = stmt.where(Tag.category == category)
    if query:
        stmt = stmt.where(Tag.name.ilike(f"{query}%"))
    tags = (await db.execute(stmt)).scalars().all()
    return [_to_tag_read(tag) for tag in tags]


async def remove_tag_from_media(db: AsyncSession, user: User, *, tag_name: str) -> TagManagementResult:
    await media_service.purge_expired_trash(db)
    tag = (await db.execute(select(Tag).where(Tag.name == tag_name))).scalar_one_or_none()
    media_rows = (
        await db.execute(
            _accessible_media_stmt(user)
            .where(Media.tags.contains([tag_name]))
            .options(selectinload(Media.media_tags).selectinload(MediaTag.tag))
        )
    ).scalars().all()

    updated = 0
    for media in media_rows:
        next_payloads = [
            (media_tag.tag.name, media_tag.tag.category, media_tag.confidence)
            for media_tag in media.media_tags
            if media_tag.tag.name != tag_name
        ]
        if len(next_payloads) == len(media.media_tags):
            continue
        await media_service._set_media_tag_links(db, media, next_payloads)
        media.is_nsfw = media_service.tag_names_mark_nsfw(media.tags)
        updated += 1

    await db.flush()
    deleted_tag = False
    if tag is not None:
        await media_service._delete_orphaned_tags(db, [tag.id])
        deleted_tag = await db.get(Tag, tag.id) is None

    await db.commit()
    return TagManagementResult(matched_media=len(media_rows), updated_media=updated, deleted_tag=deleted_tag)


async def trash_media_by_tag(db: AsyncSession, user: User, *, tag_name: str) -> TagManagementResult:
    await media_service.purge_expired_trash(db)
    matches = (await db.execute(_accessible_media_stmt(user).where(Media.tags.contains([tag_name])))).scalars().all()
    trashed = 0
    already_trashed = 0
    now = datetime.now(timezone.utc)

    for media in matches:
        if media.deleted_at is None:
            media.deleted_at = now
            trashed += 1
        else:
            already_trashed += 1

    await db.commit()
    return TagManagementResult(
        matched_media=len(matches),
        trashed_media=trashed,
        already_trashed=already_trashed,
    )


async def clear_character_name(db: AsyncSession, user: User, *, character_name: str) -> TagManagementResult:
    await media_service.purge_expired_trash(db)
    media_rows = (
        await db.execute(_accessible_media_stmt(user).where(Media.character_name == character_name))
    ).scalars().all()
    for media in media_rows:
        media.character_name = None
    await db.commit()
    return TagManagementResult(matched_media=len(media_rows), updated_media=len(media_rows))


async def trash_media_by_character_name(db: AsyncSession, user: User, *, character_name: str) -> TagManagementResult:
    await media_service.purge_expired_trash(db)
    matches = (
        await db.execute(_accessible_media_stmt(user).where(Media.character_name == character_name))
    ).scalars().all()
    trashed = 0
    already_trashed = 0
    now = datetime.now(timezone.utc)

    for media in matches:
        if media.deleted_at is None:
            media.deleted_at = now
            trashed += 1
        else:
            already_trashed += 1

    await db.commit()
    return TagManagementResult(
        matched_media=len(matches),
        trashed_media=trashed,
        already_trashed=already_trashed,
    )
