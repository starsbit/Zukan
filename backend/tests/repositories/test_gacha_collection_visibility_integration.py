from __future__ import annotations

import pytest

from backend.app.models.collection import UserCollectionItem
from backend.app.models.gacha import MediaGachaRarity, RarityTier
from backend.app.models.media import TaggingStatus
from backend.app.repositories.collection import CollectionRepository
from backend.app.repositories.gacha import GachaRepository


@pytest.mark.asyncio
async def test_collection_list_and_stats_filter_effective_nsfw(db_session, make_user, make_media):
    user = await make_user(show_nsfw=False, show_sensitive=True)
    safe = await make_media(uploader_id=user.id)
    raw_nsfw = await make_media(uploader_id=user.id, is_nsfw=True)
    override_nsfw = await make_media(uploader_id=user.id, is_nsfw=False, is_nsfw_override=True)
    override_safe = await make_media(uploader_id=user.id, is_nsfw=True, is_nsfw_override=False)
    sensitive = await make_media(uploader_id=user.id, is_sensitive=True)

    db_session.add_all(
        [
            UserCollectionItem(user_id=user.id, media_id=media.id, rarity_tier_at_acquisition=RarityTier.R)
            for media in [safe, raw_nsfw, override_nsfw, override_safe, sensitive]
        ]
    )
    await db_session.commit()

    repo = CollectionRepository(db_session)
    visible = await repo.list_items(user.id, include_nsfw=False, include_sensitive=True)

    assert {item.media_id for item in visible} == {safe.id, override_safe.id, sensitive.id}

    total, _, _, _, tier_counts = await repo.stats(user.id, include_nsfw=False, include_sensitive=True)

    assert total == 3
    assert tier_counts[RarityTier.R] == 3


@pytest.mark.asyncio
async def test_collection_filter_can_hide_sensitive_separately(db_session, make_user, make_media):
    user = await make_user(show_nsfw=True, show_sensitive=False)
    safe = await make_media(uploader_id=user.id)
    sensitive = await make_media(uploader_id=user.id, is_sensitive=True)
    nsfw = await make_media(uploader_id=user.id, is_nsfw=True)

    db_session.add_all(
        [
            UserCollectionItem(user_id=user.id, media_id=media.id, rarity_tier_at_acquisition=RarityTier.R)
            for media in [safe, sensitive, nsfw]
        ]
    )
    await db_session.commit()

    visible = await CollectionRepository(db_session).list_items(
        user.id,
        include_nsfw=True,
        include_sensitive=False,
    )

    assert {item.media_id for item in visible} == {safe.id, nsfw.id}


@pytest.mark.asyncio
async def test_gacha_pull_candidates_filter_effective_nsfw(db_session, make_user, make_media):
    user = await make_user(show_nsfw=False, show_sensitive=True)
    safe = await make_media(uploader_id=user.id, tagging_status=TaggingStatus.DONE)
    raw_nsfw = await make_media(uploader_id=user.id, is_nsfw=True, tagging_status=TaggingStatus.DONE)
    override_nsfw = await make_media(
        uploader_id=user.id,
        is_nsfw=False,
        is_nsfw_override=True,
        tagging_status=TaggingStatus.DONE,
    )
    override_safe = await make_media(
        uploader_id=user.id,
        is_nsfw=True,
        is_nsfw_override=False,
        tagging_status=TaggingStatus.DONE,
    )

    db_session.add_all(
        [
            MediaGachaRarity(media_id=media.id, rarity_tier=RarityTier.R, rarity_score=0.5, component_scores={})
            for media in [safe, raw_nsfw, override_nsfw, override_safe]
        ]
    )
    await db_session.commit()

    candidates = await GachaRepository(db_session).pull_candidates(user, RarityTier.R)

    assert {candidate.media_id for candidate in candidates} == {safe.id, override_safe.id}
