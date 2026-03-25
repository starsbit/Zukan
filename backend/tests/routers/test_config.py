from __future__ import annotations


def test_get_upload_config_contract(api_client):
    response = api_client.get("/api/v1/config/upload")

    assert response.status_code == 200
    payload = response.json()
    assert set(payload.keys()) == {"max_batch_size", "max_upload_size_mb"}
    assert payload["max_batch_size"] > 0
    assert payload["max_upload_size_mb"] > 0
