import uuid

from sqlalchemy import select

from backend.app.models import Media, Tag, User
from backend.app.services import media as media_service
from backend.app.services import tags as tag_service


def test_to_tag_read_uses_category_name_mapping(api):
    user = api.register_and_login("tags-service-mapping")
    uploaded = api.upload_media(user["access_token"], "mapping-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(uploaded["id"]))

    async def _exercise(session):
        from backend.app.models import Tag
        from sqlalchemy import select

        tag = (await session.execute(select(Tag).where(Tag.name == "rating:general"))).scalar_one()
        mapped = tag_service._to_tag_read(tag)
        assert mapped.name == "rating:general"
        assert mapped.category == 9
        assert mapped.category_name == "rating"

    api.run_db(_exercise)


def test_list_tags_filters_by_category_and_sorts_by_media_count(api):
    user = api.register_and_login("tags-service-list")
    first = api.upload_media(user["access_token"], "list-blue.png", (0, 0, 255))
    second = api.upload_media(user["access_token"], "list-green.png", (0, 255, 0))
    third = api.upload_media(user["access_token"], "list-red.png", (255, 0, 0))
    api.wait_for_media_status(str(first["id"]))
    api.wait_for_media_status(str(second["id"]))
    api.wait_for_media_status(str(third["id"]))

    async def _exercise(session):
        all_tags = await tag_service.list_tags(session, limit=20, offset=0, category=None)
        assert all_tags
        assert all_tags[0].name == "rating:general"
        assert all_tags[0].media_count >= all_tags[-1].media_count

        rating_tags = await tag_service.list_tags(session, limit=20, offset=0, category=9)
        assert rating_tags
        assert all(tag.category == 9 for tag in rating_tags)

    api.run_db(_exercise)


def test_search_tags_returns_prefix_matches_in_popularity_order(api):
    user = api.register_and_login("tags-service-search")
    first = api.upload_media(user["access_token"], "search-blue.png", (0, 0, 255))
    second = api.upload_media(user["access_token"], "search-red.png", (255, 0, 0))
    api.wait_for_media_status(str(first["id"]))
    api.wait_for_media_status(str(second["id"]))

    async def _exercise(session):
        results = await tag_service.list_tags(session, limit=10, offset=0, category=None, query="r")
        names = [tag.name for tag in results]
        assert "rose" in names
        assert all(name.startswith("r") for name in names)

    api.run_db(_exercise)


def test_list_character_suggestions_returns_prefix_matches(api):
    user = api.register_and_login("character-suggestion-service")
    first = api.upload_media(user["access_token"], "char-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(first["id"]))

    async def _exercise(session):
        owner = (await session.execute(select(User).where(User.username == "character-suggestion-service"))).scalar_one()
        results = await media_service.list_character_suggestions(
            session,
            owner,
            q="aya",
            limit=10,
        )
        assert results
        assert results[0]["name"] == "ayanami_rei"
        assert results[0]["media_count"] == 1

    api.run_db(_exercise)


def test_remove_tag_from_media_cleans_up_media_links_and_dangling_tag_rows(api):
    user = api.register_and_login("tags-service-remove-tag")
    uploaded = api.upload_media(user["access_token"], "remove-tag-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(uploaded["id"]))
    uploaded_id = uuid.UUID(str(uploaded["id"]))
    user_id = uuid.UUID(user["user"]["id"])

    trashed = api.client.patch(
        f"/media/{uploaded_id}",
        headers=api.auth_headers(user["access_token"]),
        json={"deleted": True},
    )
    assert trashed.status_code == 200

    async def _exercise(session):
        owner = await session.get(User, user_id)
        result = await tag_service.remove_tag_from_media(session, owner, tag_name="sky")
        assert result.matched_media == 1
        assert result.updated_media == 1
        assert result.deleted_tag is True

        media = await media_service._get_media_with_tags(session, uploaded_id, deleted=None)
        assert media is not None
        assert "sky" not in media.tags
        assert {item.tag.name for item in media.media_tags} == {"ayanami_rei", "blue", "rating:general"}

        assert (await session.execute(select(Tag).where(Tag.name == "sky"))).scalar_one_or_none() is None

    api.run_db(_exercise)


def test_clear_character_name_and_trash_media_by_character_name_are_owner_scoped(api):
    owner = api.register_and_login("tags-service-character-owner")
    other = api.register_and_login("tags-service-character-other")
    owner_media = api.upload_media(owner["access_token"], "owner-blue.png", (0, 0, 255))
    other_media = api.upload_media(other["access_token"], "other-blue.png", (0, 0, 254))
    api.wait_for_media_status(str(owner_media["id"]))
    api.wait_for_media_status(str(other_media["id"]))

    async def _exercise(session):
        owner_user = await session.get(User, uuid.UUID(owner["user"]["id"]))
        clear_result = await tag_service.clear_character_name(session, owner_user, character_name="ayanami_rei")
        assert clear_result.matched_media == 1
        assert clear_result.updated_media == 1

        owner_row = await session.get(Media, uuid.UUID(str(owner_media["id"])))
        other_row = await session.get(Media, uuid.UUID(str(other_media["id"])))
        assert owner_row.character_name is None
        assert other_row.character_name == "ayanami_rei"

        trash_result = await tag_service.trash_media_by_character_name(session, owner_user, character_name="ayanami_rei")
        assert trash_result.matched_media == 0
        assert trash_result.trashed_media == 0

    api.run_db(_exercise)


def test_trash_media_by_tag_counts_already_trashed_matches_without_touching_them(api):
    user = api.register_and_login("tags-service-trash-tag")
    first = api.upload_media(user["access_token"], "trash-tag-blue-a.png", (0, 0, 255))
    second = api.upload_media(user["access_token"], "trash-tag-blue-b.png", (0, 0, 254))
    api.wait_for_media_status(str(first["id"]))
    api.wait_for_media_status(str(second["id"]))

    trashed = api.client.patch(
        f"/media/{second['id']}",
        headers=api.auth_headers(user["access_token"]),
        json={"deleted": True},
    )
    assert trashed.status_code == 200
    original_deleted_at = trashed.json()["deleted_at"]

    async def _exercise(session):
        owner = await session.get(User, uuid.UUID(user["user"]["id"]))
        result = await tag_service.trash_media_by_tag(session, owner, tag_name="sky")
        assert result.matched_media == 2
        assert result.trashed_media == 1
        assert result.already_trashed == 1

        first_row = await session.get(Media, uuid.UUID(str(first["id"])))
        second_row = await session.get(Media, uuid.UUID(str(second["id"])))
        assert first_row.deleted_at is not None
        assert second_row.deleted_at.isoformat().replace("+00:00", "Z") == original_deleted_at

    api.run_db(_exercise)
