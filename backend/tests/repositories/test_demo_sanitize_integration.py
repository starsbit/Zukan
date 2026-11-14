from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from backend.app.config import settings
from backend.app.demo_sanitize import sanitize_demo_connection
from backend.app.models.albums import Album, AlbumMedia
from backend.app.models.auth import AuthSession, RefreshToken
from backend.app.models.library_storage import LibraryStorage, StorageMigration  # noqa: F401
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.tags import MediaTag, Tag
from backend.app.repositories.relations import OwnedEntityRepository


@pytest.mark.asyncio
async def test_sanitize_keeps_only_safe_media_and_scrubs_private_data(
    db_engine, db_session, make_user, make_media, monkeypatch
):
    monkeypatch.setattr(settings, "demo_mode", True)
    user = await make_user(username="real-owner", email="owner@example.com", show_nsfw=True, show_sensitive=True)
    safe = await make_media()
    nsfw = await make_media(is_nsfw=True)
    sensitive = await make_media(is_sensitive=True)
    trashed = await make_media(deleted=True)
    unflagged_override = await make_media(is_nsfw=True, is_nsfw_override=False)
    flagged_override = await make_media(is_nsfw_override=True)

    shared_tag = Tag(name="smile", category=0, media_count=0)
    nsfw_tag = Tag(name="explicit_only", category=0, media_count=0)
    db_session.add_all([shared_tag, nsfw_tag])
    await db_session.flush()
    db_session.add_all(
        [
            MediaTag(media_id=safe.id, tag_id=shared_tag.id, confidence=0.9),
            MediaTag(media_id=nsfw.id, tag_id=shared_tag.id, confidence=0.9),
            MediaTag(media_id=nsfw.id, tag_id=nsfw_tag.id, confidence=0.9),
        ]
    )
    entities = OwnedEntityRepository(db_session)
    kept_entity = await entities.get_or_create(entity_type=MediaEntityType.character, name="Saber")
    dropped_entity = await entities.get_or_create(entity_type=MediaEntityType.character, name="Hidden")
    db_session.add_all(
        [
            MediaEntity(media_id=safe.id, entity_id=kept_entity.id, entity_type=MediaEntityType.character, name="Saber", role="primary", source="manual"),
            MediaEntity(media_id=sensitive.id, entity_id=dropped_entity.id, entity_type=MediaEntityType.character, name="Hidden", role="primary", source="manual"),
        ]
    )
    mixed_album = Album(name="Mixed", cover_media_id=nsfw.id)
    nsfw_album = Album(name="Only NSFW")
    db_session.add_all([mixed_album, nsfw_album])
    await db_session.flush()
    db_session.add_all(
        [
            AlbumMedia(album_id=mixed_album.id, media_id=nsfw.id, position=0),
            AlbumMedia(album_id=mixed_album.id, media_id=safe.id, position=1),
            AlbumMedia(album_id=nsfw_album.id, media_id=trashed.id, position=0),
        ]
    )
    session = AuthSession(auth_config="test", revoked=False, expires_at=datetime.now(timezone.utc) + timedelta(days=1))
    db_session.add(session)
    await db_session.flush()
    db_session.add(
        RefreshToken(session_id=session.id, user_id=user.id, token_hash="hash", remember_me=False, expires_at=session.expires_at, revoked=False)
    )
    await db_session.commit()

    async with db_engine.begin() as conn:
        removed = await sanitize_demo_connection(conn)
        assert removed["media"] == 4
        assert removed["albums"] == 1

        remaining = set((await conn.execute(text("SELECT id FROM media"))).scalars())
        assert remaining == {safe.id, unflagged_override.id}
        assert flagged_override.id not in remaining
        tags = dict((await conn.execute(text("SELECT name, media_count FROM tags"))).all())
        assert tags == {"smile": 1}
        entity_names = set((await conn.execute(text("SELECT name FROM owned_entities"))).scalars())
        assert entity_names == {"Saber"}
        albums = (await conn.execute(text("SELECT name, cover_media_id FROM albums"))).all()
        assert albums == [("Mixed", safe.id)]
        for table in ("refresh_tokens", "auth_sessions"):
            assert (await conn.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one() == 0
        owner = (await conn.execute(text("SELECT username, email, show_nsfw, show_sensitive FROM users"))).one()
        assert tuple(owner) == ("demo", "demo@localhost", False, False)

        assert (await sanitize_demo_connection(conn))["media"] == 0
