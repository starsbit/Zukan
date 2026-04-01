from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from backend.app.models.media import MediaVisibility
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.tags import MediaTag, Tag
from backend.app.repositories import media_filters
from backend.app.schemas import MediaMetadataFilter, NsfwFilter, TagFilterMode


@pytest.mark.asyncio
async def test_media_filters_tag_character_ocr_and_nsfw(db_session, make_user, make_media):
    user = await make_user()
    m1 = await make_media(uploader_id=user.id, is_nsfw=False)
    m2 = await make_media(uploader_id=user.id, is_nsfw=True)

    t_safe = Tag(name="safe", category=0, media_count=1)
    t_nsfw = Tag(name="nsfw", category=9, media_count=1)
    db_session.add_all([t_safe, t_nsfw])
    await db_session.flush()
    db_session.add_all(
        [
            MediaTag(media_id=m1.id, tag_id=t_safe.id, confidence=0.9),
            MediaTag(media_id=m2.id, tag_id=t_nsfw.id, confidence=0.9),
            MediaEntity(media_id=m1.id, entity_type=MediaEntityType.character, name="Saber Alter", role="primary", source="manual", confidence=0.9),
        ]
    )
    m1.ocr_text = "fate stay"
    await db_session.flush()

    stmt = select(type(m1))
    stmt = media_filters.apply_tag_filters(stmt, ["safe"], None, TagFilterMode.AND)
    rows = (await db_session.execute(stmt)).scalars().all()
    assert {r.id for r in rows} == {m1.id}

    stmt2 = select(type(m1))
    stmt2 = media_filters.apply_tag_filters(stmt2, None, ["nsfw"], TagFilterMode.OR)
    rows2 = (await db_session.execute(stmt2)).scalars().all()
    assert {r.id for r in rows2} == {m1.id}

    stmt3 = media_filters.apply_character_name_filter(select(type(m1)), "saber alter")
    rows3 = (await db_session.execute(stmt3)).scalars().all()
    assert {r.id for r in rows3} == {m1.id}

    stmt4 = media_filters.apply_ocr_text_filter(select(type(m1)), "fate")
    rows4 = (await db_session.execute(stmt4)).scalars().all()
    assert {r.id for r in rows4} == {m1.id}

    stmt5 = media_filters.apply_nsfw_list_filter(select(type(m1)), user, NsfwFilter.DEFAULT)
    rows5 = (await db_session.execute(stmt5)).scalars().all()
    assert {r.id for r in rows5} == {m1.id}


@pytest.mark.asyncio
async def test_media_filters_media_type_and_captured_at(db_session, make_user, make_media):
    user = await make_user()
    m1 = await make_media(uploader_id=user.id)
    m2 = await make_media(uploader_id=user.id)
    m1.captured_at = datetime.now(timezone.utc) - timedelta(days=365)
    m2.captured_at = datetime.now(timezone.utc)
    await db_session.flush()

    stmt = media_filters.apply_media_type_filters(select(type(m1)), ["image"])
    rows = (await db_session.execute(stmt)).scalars().all()
    assert len(rows) >= 2

    metadata = MediaMetadataFilter(captured_before=datetime.now(timezone.utc) - timedelta(days=100))
    stmt2 = media_filters.apply_captured_at_filters(select(type(m1)), metadata)
    rows2 = (await db_session.execute(stmt2)).scalars().all()
    assert {r.id for r in rows2} == {m1.id}


def test_fuzzy_ocr_pattern_helper():
    assert media_filters._build_fuzzy_ocr_like_pattern("abc") is None
    pattern = media_filters._build_fuzzy_ocr_like_pattern("ab cd")
    assert pattern == "%a%b%c%d%"


@pytest.mark.asyncio
async def test_media_filters_support_tag_modes_visibility_and_ocr_fallbacks(db_session, make_user, make_media):
    user = await make_user()
    m1 = await make_media(uploader_id=user.id)
    m2 = await make_media(uploader_id=user.id)
    m3 = await make_media(uploader_id=user.id)

    tag_hero = Tag(name="hero", category=0, media_count=2)
    tag_night = Tag(name="night", category=0, media_count=2)
    tag_spoiler = Tag(name="spoiler", category=0, media_count=1)
    db_session.add_all([tag_hero, tag_night, tag_spoiler])
    await db_session.flush()

    m1.visibility = MediaVisibility.public
    m2.visibility = MediaVisibility.public
    m3.visibility = MediaVisibility.private
    m1.ocr_text_override = "fa-te route"
    m2.ocr_text = "fate night"
    await db_session.flush()

    db_session.add_all(
        [
            MediaTag(media_id=m1.id, tag_id=tag_hero.id, confidence=0.9),
            MediaTag(media_id=m1.id, tag_id=tag_night.id, confidence=0.9),
            MediaTag(media_id=m2.id, tag_id=tag_hero.id, confidence=0.9),
            MediaTag(media_id=m3.id, tag_id=tag_spoiler.id, confidence=0.9),
        ]
    )
    await db_session.flush()

    stmt = media_filters.apply_tag_filters(select(type(m1)), ["hero", "night"], None, TagFilterMode.AND)
    rows = (await db_session.execute(stmt)).scalars().all()
    assert {row.id for row in rows} == {m1.id}

    stmt = media_filters.apply_tag_filters(select(type(m1)), ["hero", "night"], ["spoiler"], TagFilterMode.OR)
    rows = (await db_session.execute(stmt)).scalars().all()
    assert {row.id for row in rows} == {m1.id, m2.id}

    stmt = media_filters.apply_visibility_filter(select(type(m1)), MediaVisibility.public)
    rows = (await db_session.execute(stmt)).scalars().all()
    assert {row.id for row in rows} == {m1.id, m2.id}

    stmt = media_filters.apply_ocr_text_filter(select(type(m1)), "fate")
    rows = (await db_session.execute(stmt)).scalars().all()
    assert {row.id for row in rows} == {m1.id, m2.id}


@pytest.mark.asyncio
async def test_media_filters_support_combined_captured_at_constraints(db_session, make_user, make_media):
    user = await make_user()
    march_match = await make_media(uploader_id=user.id)
    future_media = await make_media(uploader_id=user.id)

    march_match.captured_at = datetime(2026, 3, 29, 12, 0, tzinfo=timezone.utc)
    future_media.captured_at = datetime(2027, 1, 1, 12, 0, tzinfo=timezone.utc)
    await db_session.flush()

    metadata = MediaMetadataFilter(
        captured_year=2026,
        captured_month=3,
        captured_day=29,
        captured_before_year=2027,
    )
    stmt = media_filters.apply_captured_at_filters(select(type(march_match)), metadata)
    rows = (await db_session.execute(stmt)).scalars().all()
    assert {row.id for row in rows} == {march_match.id}
