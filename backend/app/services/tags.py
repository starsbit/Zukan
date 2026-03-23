from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.errors import AppError, tag_not_found
from backend.app.models.media import Media, MediaTag, User
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.tags import Tag
from backend.app.repositories.relations import MediaEntityRepository
from backend.app.repositories.tags import TagRepository
from backend.app.schemas import CATEGORY_NAMES, TagListResponse, TagManagementResult, TagRead
from backend.app.services import media as media_service


def _to_tag_read(tag: Tag) -> TagRead:
    category_key = CATEGORY_NAMES.get(tag.category, "unknown")
    return TagRead(
        id=tag.id,
        name=tag.name,
        category=tag.category,
        category_name=category_key,
        category_key=category_key,
        media_count=tag.media_count,
    )


async def get_tag_by_id(db: AsyncSession, tag_id: int) -> Tag:
    tag = await TagRepository(db).get_by_id(tag_id)
    if tag is None:
        raise AppError(status_code=404, code=tag_not_found, detail="Tag not found")
    return tag


async def remove_tag_from_media_by_id(db: AsyncSession, user: User, *, tag_id: int) -> TagManagementResult:
    tag = await get_tag_by_id(db, tag_id)
    return await remove_tag_from_media(db, user, tag_name=tag.name)


async def trash_media_by_tag_id(db: AsyncSession, user: User, *, tag_id: int) -> TagManagementResult:
    tag = await get_tag_by_id(db, tag_id)
    return await trash_media_by_tag(db, user, tag_name=tag.name)


def _accessible_media_stmt(user: User):
    stmt = select(Media)
    if not user.is_admin:
        stmt = stmt.where(Media.uploader_id == user.id)
    return stmt


async def list_tags(
    db: AsyncSession,
    *,
    page: int = 1,
    page_size: int = 100,
    category: int | None,
    query: str | None = None,
    sort_by: str = "media_count",
    sort_order: str = "desc",
    limit: int | None = None,
    offset: int | None = None,
) -> TagListResponse:
    sort_col = Tag.name if sort_by == "name" else Tag.media_count
    order_expr = sort_col.asc() if sort_order == "asc" else sort_col.desc()
    base_stmt = select(Tag)
    if category is not None:
        base_stmt = base_stmt.where(Tag.category == category)
    if query:
        base_stmt = base_stmt.where(Tag.name.ilike(f"{query}%"))
    tags_repo = TagRepository(db)
    total = await tags_repo.count(base_stmt)
    if limit is not None and offset is not None:
        tag_list = await tags_repo.list(base_stmt=base_stmt, order_expr=order_expr, offset=offset, limit=limit)
    else:
        tag_list = await tags_repo.list(base_stmt=base_stmt, order_expr=order_expr, offset=(page - 1) * page_size, limit=page_size)
    return TagListResponse(total=total, page=page, page_size=page_size, items=[_to_tag_read(tag) for tag in tag_list])


async def remove_tag_from_media(db: AsyncSession, user: User, *, tag_name: str) -> TagManagementResult:
    await media_service.purge_expired_trash(db)
    tags_repo = TagRepository(db)
    tag = await tags_repo.get_by_name(tag_name)
    media_rows = (
        await db.execute(
            _accessible_media_stmt(user)
            .where(Media.id.in_(select(MediaTag.media_id).join(Tag).where(Tag.name == tag_name)))
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
        await tags_repo.set_media_tag_links(media, next_payloads)
        media.is_nsfw = media_service.tag_names_mark_nsfw([name for name, _, _ in next_payloads])
        updated += 1

    await db.flush()
    deleted_tag = False
    if tag is not None:
        remaining = await tags_repo.get_by_id(tag.id)
        deleted_tag = remaining is None

    await db.commit()
    return TagManagementResult(matched_media=len(media_rows), updated_media=updated, deleted_tag=deleted_tag)


async def trash_media_by_tag(db: AsyncSession, user: User, *, tag_name: str) -> TagManagementResult:
    await media_service.purge_expired_trash(db)
    matches = (
        await db.execute(
            _accessible_media_stmt(user)
            .where(Media.id.in_(select(MediaTag.media_id).join(Tag).where(Tag.name == tag_name)))
        )
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


async def clear_character_name(db: AsyncSession, user: User, *, character_name: str) -> TagManagementResult:
    await media_service.purge_expired_trash(db)
    char_media_ids = select(MediaEntity.media_id).where(
        MediaEntity.entity_type == MediaEntityType.character,
        MediaEntity.name == character_name,
    )
    media_rows = (
        await db.execute(_accessible_media_stmt(user).where(Media.id.in_(char_media_ids)))
    ).scalars().all()
    accessible_ids = {m.id for m in media_rows}
    entities = await MediaEntityRepository(db).get_char_entities_by_name(accessible_ids, character_name)
    for entity in entities:
        await db.delete(entity)
    await db.commit()
    return TagManagementResult(matched_media=len(media_rows), updated_media=len(media_rows))


async def trash_media_by_character_name(db: AsyncSession, user: User, *, character_name: str) -> TagManagementResult:
    await media_service.purge_expired_trash(db)
    char_media_ids = select(MediaEntity.media_id).where(
        MediaEntity.entity_type == MediaEntityType.character,
        MediaEntity.name == character_name,
    )
    matches = (
        await db.execute(_accessible_media_stmt(user).where(Media.id.in_(char_media_ids)))
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
