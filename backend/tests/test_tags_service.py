from sqlalchemy import select

from backend.app.models import User
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
