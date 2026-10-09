from unittest.mock import AsyncMock
from backend.app.routers import storage


def test_storage_is_admin_only(unauthenticated_client):
    assert unauthenticated_client.get('/api/v1/admin/storage').status_code == 401


def test_storage_root_cannot_be_patched(api_client):
    response = api_client.patch('/api/v1/admin/storage', json={'root': '/new'})
    assert response.status_code == 422


def test_storage_destination_validation_contract(api_client, monkeypatch):
    validate = AsyncMock(return_value={'destination_root': '/library', 'required_bytes': 10, 'total_files': 1})
    monkeypatch.setattr(storage.service, 'validate_destination', validate)
    response = api_client.post('/api/v1/admin/storage/validate', json={'root': '/library'})
    assert response.status_code == 200 and response.json()['total_files'] == 1
    validate.assert_awaited_once()


def test_storage_conflicts_return_reviewable_errors(api_client, monkeypatch):
    monkeypatch.setattr(storage.service, 'validate_destination', AsyncMock(side_effect=ValueError('Destination contains different content')))
    response = api_client.post('/api/v1/admin/storage/validate', json={'root': '/library'})
    assert response.status_code == 409 and 'different content' in str(response.json())


def test_folder_confirmation_requires_admin(unauthenticated_client):
    response = unauthenticated_client.post('/api/v1/admin/storage/confirm', json={'root': '/library'})
    assert response.status_code == 401


def test_folder_confirmation_contract(api_client, monkeypatch):
    confirm = AsyncMock(return_value={'folder_configured': True})
    monkeypatch.setattr(storage.service, 'confirm_storage_folder', confirm)
    response = api_client.post('/api/v1/admin/storage/confirm', json={'root': '/library'})
    assert response.status_code == 200 and response.json() == {'folder_configured': True}
    confirm.assert_awaited_once()


def test_maintenance_requires_admin_and_explicit_acknowledgment(unauthenticated_client, api_client):
    assert unauthenticated_client.get('/api/v1/admin/storage/maintenance').status_code == 401
    body = {'media_ids': ['007954ed-2b86-43c4-8798-232aa0c57c0a'], 'root': '/library',
            'root_identity': 'identity', 'confirm_permanent_deletion': False}
    assert unauthenticated_client.post('/api/v1/admin/storage/maintenance/cleanup', json=body).status_code == 401
    assert api_client.post('/api/v1/admin/storage/maintenance/cleanup', json=body).status_code == 422
