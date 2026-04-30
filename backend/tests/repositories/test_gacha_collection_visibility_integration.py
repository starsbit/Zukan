from __future__ import annotations

import pytest

from backend.app.models.collection import CollectionVisibility, UserCollectionItem, UserCollectionPrivacy
from backend.app.models.gacha import MediaGachaRarity, RarityTier
from backend.app.models.media import TaggingStatus
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.tags import MediaTag, Tag
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
async def test_collection_filters_and_payload_include_metadata(db_session, make_user, make_media):
    user = await make_user()
    saber_media = await make_media(uploader_id=user.id)
    rin_media = await make_media(uploader_id=user.id)
    tag = Tag(owner_user_id=user.id, name="white hair", category=0)
    db_session.add(tag)
    await db_session.flush()
    db_session.add_all(
        [
            UserCollectionItem(user_id=user.id, media_id=saber_media.id, rarity_tier_at_acquisition=RarityTier.SR),
            UserCollectionItem(user_id=user.id, media_id=rin_media.id, rarity_tier_at_acquisition=RarityTier.R),
            MediaTag(media_id=saber_media.id, tag_id=tag.id, confidence=1.0),
            MediaEntity(
                media_id=saber_media.id,
                entity_type=MediaEntityType.character,
                name="Saber",
                role="primary",
                source="manual",
            ),
            MediaEntity(
                media_id=saber_media.id,
                entity_type=MediaEntityType.series,
                name="Fate",
                role="primary",
                source="manual",
            ),
        ]
    )
    await db_session.commit()

    visible = await CollectionRepository(db_session).list_items(
        user.id,
        tags=["white hair"],
        character_names=["Saber"],
        series_names=["Fate"],
    )

    assert [item.media_id for item in visible] == [saber_media.id]
    assert [tag.tag.name for tag in visible[0].media.media_tags] == ["white hair"]
    assert {entity.name for entity in visible[0].media.entities} == {"Saber", "Fate"}


@pytest.mark.asyncio
async def test_public_collection_owner_discovery_filters_privacy_trade_and_search(db_session, make_user):
    viewer = await make_user(username="viewer", email="viewer@example.com")
    public_trader = await make_user(username="Sakura", email="sakura@example.com")
    public_closed = await make_user(username="Saber", email="saber@example.com")
    private_owner = await make_user(username="Shirou", email="shirou@example.com")

    db_session.add_all(
        [
            UserCollectionPrivacy(
                user_id=viewer.id,
                visibility=CollectionVisibility.public,
                allow_trade_requests=True,
                show_stats=True,
            ),
            UserCollectionPrivacy(
                user_id=public_trader.id,
                visibility=CollectionVisibility.public,
                allow_trade_requests=True,
                show_stats=False,
            ),
            UserCollectionPrivacy(
                user_id=public_closed.id,
                visibility=CollectionVisibility.public,
                allow_trade_requests=False,
                show_stats=True,
            ),
            UserCollectionPrivacy(
                user_id=private_owner.id,
                visibility=CollectionVisibility.private,
                allow_trade_requests=True,
                show_stats=True,
            ),
        ]
    )
    await db_session.commit()

    repo = CollectionRepository(db_session)
    all_public = await repo.list_public_collection_owners(viewer_id=viewer.id)
    tradeable = await repo.list_public_collection_owners(viewer_id=viewer.id, tradeable_only=True)
    searched = await repo.list_public_collection_owners(viewer_id=viewer.id, q="sak")

    assert [owner["username"] for owner in all_public] == ["Saber", "Sakura"]
    assert [owner["username"] for owner in tradeable] == ["Sakura"]
    assert [owner["username"] for owner in searched] == ["Sakura"]
    assert all(owner["user_id"] != viewer.id for owner in all_public)


@pytest.mark.asyncio
async def test_collection_privacy_defaults_to_public(db_session, make_user):
    user = await make_user(username="rin", email="rin@example.com")

    privacy = await CollectionRepository(db_session).get_or_create_privacy(user.id)

    assert privacy.visibility == CollectionVisibility.public


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
