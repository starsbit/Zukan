import uuid

from sqlalchemy import select
from backend.app.models.auth import User
from backend.app.models.media import Media
from backend.app.models.tags import Tag
from backend.app.services import media as media_service
from backend.app.services import tags as tag_service


def test_to_tag_read_uses_category_name_mapping(api):
    user = api.register_and_login("tags-service-mapping")
    uploaded = api.upload_media(user["access_token"], "mapping-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(uploaded["id"]))

    async def _exercise(session):
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
        assert all_tags.items
        assert all_tags.items[0].name == "rating:general"
        assert all_tags.items[0].media_count >= all_tags.items[-1].media_count

        rating_tags = await tag_service.list_tags(session, limit=20, offset=0, category=9)
        assert rating_tags.items
        assert all(tag.category == 9 for tag in rating_tags.items)

    api.run_db(_exercise)


def test_search_tags_returns_prefix_matches_in_popularity_order(api):
    user = api.register_and_login("tags-service-search")
    first = api.upload_media(user["access_token"], "search-blue.png", (0, 0, 255))
    second = api.upload_media(user["access_token"], "search-red.png", (255, 0, 0))
    api.wait_for_media_status(str(first["id"]))
    api.wait_for_media_status(str(second["id"]))

    async def _exercise(session):
        results = await tag_service.list_tags(session, limit=10, offset=0, category=None, query="r")
        names = [tag.name for tag in results.items]
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
        assert "sky" not in {mt.tag.name for mt in media.media_tags}
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

def test_tag_read_exposes_category_key(api):
    user = api.register_and_login("catkey-user")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "catkey-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    tags = api.client.get("/tags", headers=headers, params={"q": "sky"})
    assert tags.status_code == 200
    items = tags.json()["items"]
    assert len(items) >= 1
    tag = next(t for t in items if t["name"] == "sky")
    assert tag["category_key"] == "general"
    assert tag["category_name"] == "general"
    assert isinstance(tag["category"], int)


def test_tag_with_confidence_exposes_category_key(api):
    user = api.register_and_login("catkey-detail-user")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "catkey-detail-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    detail = api.client.get(f"/media/{blue['id']}", headers=headers)
    assert detail.status_code == 200
    tag_details = detail.json()["tag_details"]
    assert len(tag_details) > 0
    for td in tag_details:
        assert "category_key" in td
        assert td["category_key"] in ("general", "artist", "copyright", "character", "meta", "rating", "unknown")

def test_tag_action_with_name_returns_422(api):
    user = api.register_and_login("tagid-422-user")
    headers = api.auth_headers(user["access_token"])
    resp = api.client.post("/tags/forest/actions/trash-media", headers=headers)
    assert resp.status_code == 422


def test_tag_action_with_unknown_id_returns_404(api):
    user = api.register_and_login("tagid-404-user")
    headers = api.auth_headers(user["access_token"])
    resp = api.client.post("/tags/999999/actions/trash-media", headers=headers)
    assert resp.status_code == 404
    assert resp.json()["code"] == "tag_not_found"


def test_tag_remove_from_media_by_id(api):
    user = api.register_and_login("tagid-remove-user")
    headers = api.auth_headers(user["access_token"])
    green = api.upload_media(user["access_token"], "tagid-green.png", (0, 255, 0))
    api.wait_for_media_status(str(green["id"]))

    tags_resp = api.client.get("/tags", headers=headers, params={"q": "forest"})
    assert tags_resp.status_code == 200
    tag_id = tags_resp.json()["items"][0]["id"]

    remove = api.client.post(f"/tags/{tag_id}/actions/remove-from-media", headers=headers)
    assert remove.status_code == 200
    assert remove.json()["matched_media"] == 1
    assert remove.json()["updated_media"] == 1


def test_tag_trash_media_by_id(api):
    user = api.register_and_login("tagid-trash-user")
    headers = api.auth_headers(user["access_token"])
    green = api.upload_media(user["access_token"], "tagid-trash-green.png", (0, 255, 0))
    api.wait_for_media_status(str(green["id"]))

    tags_resp = api.client.get("/tags", headers=headers, params={"q": "forest"})
    tag_id = tags_resp.json()["items"][0]["id"]

    trash = api.client.post(f"/tags/{tag_id}/actions/trash-media", headers=headers)
    assert trash.status_code == 200
    assert trash.json()["trashed_media"] == 1

def test_ocr_text_field_is_read_only_in_api(api):
    user = api.register_and_login("ocr-readonly-user")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "ocr-ro-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    patch = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"ocr_text": "should be rejected"},
    )
    assert patch.status_code == 422


def test_ocr_text_override_is_distinct_from_system_ocr(api):
    user = api.register_and_login("ocr-distinct-user")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "ocr-dist-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    patch = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"ocr_text_override": "My correction"},
    )
    assert patch.status_code == 200
    body = patch.json()
    assert body["ocr_text_override"] == "My correction"
    assert body["ocr_text"] is None


def test_ocr_text_search_matches_override(api):
    user = api.register_and_login("ocr-search-override-user")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "ocr-search-blue.png", (0, 0, 255))
    green = api.upload_media(user["access_token"], "ocr-search-green.png", (0, 255, 0))
    api.wait_for_media_status(str(blue["id"]))
    api.wait_for_media_status(str(green["id"]))

    api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"ocr_text_override": "invoice number 42"},
    )

    hit = api.client.get("/media", headers=headers, params={"ocr_text": "invoice"})
    assert hit.status_code == 200
    ids = [item["id"] for item in hit.json()["items"]]
    assert str(blue["id"]) in ids
    assert str(green["id"]) not in ids


def test_ocr_text_override_clear(api):
    user = api.register_and_login("ocr-clear-user")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "ocr-clear-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    api.client.patch(f"/media/{blue['id']}", headers=headers, json={"ocr_text_override": "some text"})

    cleared = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"ocr_text_override": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["ocr_text_override"] is None