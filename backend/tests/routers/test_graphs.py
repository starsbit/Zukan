from __future__ import annotations

import uuid

from backend.app.ml.embedding import EMBEDDING_MODEL_VERSION


def test_character_graph_search_contract(api_client, monkeypatch):
    entity_id = uuid.uuid4()

    class _FakeService:
        def __init__(self, db):
            pass

        async def search_characters(self, user, *, q, limit):
            assert q == "saber"
            assert limit == 5
            return [{"id": entity_id, "name": "Saber", "media_count": 12}]

    monkeypatch.setattr("backend.app.routers.graphs.CharacterGraphService", _FakeService)

    response = api_client.get("/api/v1/graphs/characters/search", params={"q": "saber", "limit": 5})

    assert response.status_code == 200
    assert response.json() == [{"id": str(entity_id), "name": "Saber", "media_count": 12}]


def test_character_graph_contract(api_client, monkeypatch):
    center_id = uuid.uuid4()
    neighbor_id = uuid.uuid4()
    media_id = uuid.uuid4()

    class _FakeService:
        def __init__(self, db):
            pass

        async def get_character_graph(
            self,
            user,
            *,
            center_entity_id,
            center_name,
            limit,
            min_similarity,
            series_mode,
            sample_size,
        ):
            assert center_entity_id == center_id
            assert center_name is None
            assert limit == 20
            assert min_similarity == 0.8
            assert series_mode == "same"
            assert sample_size == 4
            return {
                "model_version": EMBEDDING_MODEL_VERSION,
                "total_characters_considered": 2,
                "center_entity_id": center_id,
                "nodes": [
                    {
                        "id": center_id,
                        "name": "Saber",
                        "media_count": 5,
                        "embedding_support": 5,
                        "series_names": ["fate"],
                        "representative_media_ids": [media_id],
                    },
                    {
                        "id": neighbor_id,
                        "name": "Rin Tohsaka",
                        "media_count": 4,
                        "embedding_support": 4,
                        "series_names": ["fate"],
                        "representative_media_ids": [],
                    },
                ],
                "edges": [
                    {
                        "id": f"{center_id}:{neighbor_id}",
                        "source": center_id,
                        "target": neighbor_id,
                        "similarity": 0.91,
                        "shared_series": ["fate"],
                    }
                ],
            }

    monkeypatch.setattr("backend.app.routers.graphs.CharacterGraphService", _FakeService)

    response = api_client.get(
        "/api/v1/graphs/characters",
        params={
            "center_entity_id": str(center_id),
            "limit": 20,
            "min_similarity": 0.8,
            "series_mode": "same",
            "sample_size": 4,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["center_entity_id"] == str(center_id)
    assert body["nodes"][0]["representative_media_ids"] == [str(media_id)]
    assert body["edges"][0]["shared_series"] == ["fate"]


def test_character_graph_requires_authentication(unauthenticated_client):
    response = unauthenticated_client.get("/api/v1/graphs/characters")

    assert response.status_code in {401, 403}
