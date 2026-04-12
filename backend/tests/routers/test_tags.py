from __future__ import annotations

from backend.app.services.relations import RelationService
from backend.app.services.tags import TagService


_RESULT = {
    "matched_media": 2,
    "updated_media": 1,
    "trashed_media": 1,
    "already_trashed": 1,
    "deleted_tag": False,
}


def test_list_tags_contract(api_client, monkeypatch):
    async def _fake_list(self, user, after, page_size, category, query, sort_by, sort_order, scope):
        assert scope == "owner"
        return {
            "total": 1,
            "next_cursor": None,
            "has_more": False,
            "page_size": page_size,
            "items": [
                {
                    "id": 1,
                    "name": "cat",
                    "category": 0,
                    "category_name": "general",
                    "category_key": "general",
                    "media_count": 10,
                }
            ],
        }

    monkeypatch.setattr(TagService, "list_tags", _fake_list)

    response = api_client.get("/api/v1/tags", params={"q": "cat", "page_size": 5, "scope": "owner"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["name"] == "cat"


def test_list_character_names_contract(api_client, monkeypatch):
    async def _fake_list(self, user, after, page_size, query, sort_by, sort_order, scope):
        assert query == "Sab"
        assert scope == "owner"
        return {
            "total": 1,
            "next_cursor": None,
            "has_more": False,
            "page_size": page_size,
            "items": [
                {
                    "name": "Saber",
                    "media_count": 7,
                }
            ],
        }

    monkeypatch.setattr(RelationService, "list_character_names", _fake_list)

    response = api_client.get("/api/v1/character-names", params={"q": "Sab", "page_size": 5, "scope": "owner"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["name"] == "Saber"


def test_list_series_names_contract(api_client, monkeypatch):
    async def _fake_list(self, user, after, page_size, query, sort_by, sort_order, scope):
        assert query == "Fa"
        assert scope == "owner"
        return {
            "total": 1,
            "next_cursor": None,
            "has_more": False,
            "page_size": page_size,
            "items": [
                {
                    "name": "Fate",
                    "media_count": 4,
                }
            ],
        }

    monkeypatch.setattr(RelationService, "list_series_names", _fake_list)

    response = api_client.get("/api/v1/series-names", params={"q": "Fa", "page_size": 5, "scope": "owner"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["name"] == "Fate"


def test_remove_tag_from_media_contract(api_client, monkeypatch):
    async def _fake_remove(self, user, tag_id: int):
        assert tag_id == 3
        return _RESULT

    monkeypatch.setattr(TagService, "remove_tag_from_media_by_id", _fake_remove)

    response = api_client.post("/api/v1/tags/3/actions/remove-from-media")

    assert response.status_code == 200
    assert response.json()["matched_media"] == 2


def test_merge_tag_contract(api_client, monkeypatch):
    async def _fake_merge(self, user, tag_id: int, target_tag_id: int):
        assert tag_id == 3
        assert target_tag_id == 9
        return _RESULT

    monkeypatch.setattr(TagService, "merge_tag_by_id", _fake_merge)

    response = api_client.post("/api/v1/tags/3/actions/merge", json={"target_tag_id": 9})

    assert response.status_code == 200
    assert response.json()["updated_media"] == 1


def test_trash_media_by_tag_contract(api_client, monkeypatch):
    async def _fake_trash(self, user, tag_id: int):
        assert tag_id == 7
        return _RESULT

    monkeypatch.setattr(TagService, "trash_media_by_tag_id", _fake_trash)

    response = api_client.post("/api/v1/tags/7/actions/trash-media")

    assert response.status_code == 200
    assert response.json()["trashed_media"] == 1


def test_remove_character_name_contract(api_client, monkeypatch):
    async def _fake_clear(self, user, character_name: str):
        assert character_name == "Saber"
        return _RESULT

    monkeypatch.setattr(RelationService, "clear_character_name", _fake_clear)

    response = api_client.post("/api/v1/character-names/Saber/actions/remove-from-media")

    assert response.status_code == 200
    assert response.json()["updated_media"] == 1


def test_merge_character_name_contract(api_client, monkeypatch):
    async def _fake_merge(self, user, character_name: str, target_name: str):
        assert character_name == "Saber"
        assert target_name == "Artoria"
        return _RESULT

    monkeypatch.setattr(RelationService, "merge_character_name", _fake_merge)

    response = api_client.post("/api/v1/character-names/Saber/actions/merge", json={"target_name": "Artoria"})

    assert response.status_code == 200
    assert response.json()["updated_media"] == 1


def test_trash_character_name_contract(api_client, monkeypatch):
    async def _fake_trash(self, user, character_name: str):
        assert character_name == "Rin"
        return _RESULT

    monkeypatch.setattr(RelationService, "trash_media_by_character_name", _fake_trash)

    response = api_client.post("/api/v1/character-names/Rin/actions/trash-media")

    assert response.status_code == 200
    assert response.json()["already_trashed"] == 1


def test_remove_series_name_contract(api_client, monkeypatch):
    async def _fake_clear(self, user, series_name: str):
        assert series_name == "Fate"
        return _RESULT

    monkeypatch.setattr(RelationService, "clear_series_name", _fake_clear)

    response = api_client.post("/api/v1/series-names/Fate/actions/remove-from-media")

    assert response.status_code == 200
    assert response.json()["updated_media"] == 1


def test_merge_series_name_contract(api_client, monkeypatch):
    async def _fake_merge(self, user, series_name: str, target_name: str):
        assert series_name == "Fate"
        assert target_name == "Fate/stay night"
        return _RESULT

    monkeypatch.setattr(RelationService, "merge_series_name", _fake_merge)

    response = api_client.post("/api/v1/series-names/Fate/actions/merge", json={"target_name": "Fate/stay night"})

    assert response.status_code == 200
    assert response.json()["updated_media"] == 1
