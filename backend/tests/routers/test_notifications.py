from __future__ import annotations
from datetime import datetime, timezone
import uuid
from backend.app.services.notifications import NotificationService

def test_list_notifications_contract(api_client, monkeypatch):

    async def _fake_list(self, after, page_size, is_read):
        return {'total': 1, 'next_cursor': None, 'has_more': False, 'page_size': page_size, 'items': [{'id': str(uuid.uuid4()), 'user_id': str(None), 'type': 'batch_done', 'title': 'Album invite', 'body': 'Accept to join as viewer.', 'is_read': False, 'link_url': '/album/123', 'data': {'album_id': '123', 'album_name': 'Trip', 'role': 'viewer', 'invited_by_user_id': str(uuid.uuid4()), 'invited_by_username': 'owner', 'invite_status': 'pending', 'invite_id': str(uuid.uuid4())}, 'created_at': datetime.now(timezone.utc).isoformat()}]}
    monkeypatch.setattr(NotificationService, 'list_notifications', _fake_list)
    response = api_client.get('/api/v1/me/notifications', params={'page_size': 4, 'is_read': False})
    assert response.status_code == 200
    assert response.json()['items'][0]['type'] == 'batch_done'


def test_mark_notification_read_contract(api_client, monkeypatch):

    async def _fake_mark(self, notification_id):
        return {'id': str(notification_id), 'user_id': str(None), 'type': 'batch_done', 'title': 'Batch complete', 'body': 'Your upload batch finished', 'is_read': True, 'link_url': None, 'data': None, 'created_at': datetime.now(timezone.utc).isoformat()}
    monkeypatch.setattr(NotificationService, 'mark_read', _fake_mark)
    response = api_client.patch(f'/api/v1/me/notifications/{uuid.uuid4()}/read')
    assert response.status_code == 200
    assert response.json()['is_read'] is True

def test_mark_all_notifications_read_contract(api_client, monkeypatch):

    async def _fake_mark_all(self):
        return None
    monkeypatch.setattr(NotificationService, 'mark_all_read', _fake_mark_all)
    response = api_client.post('/api/v1/me/notifications/read-all')
    assert response.status_code == 204
    assert response.content == b''

def test_delete_notification_contract(api_client, monkeypatch):

    async def _fake_delete(self, notification_id):
        return None
    monkeypatch.setattr(NotificationService, 'delete_notification', _fake_delete)
    response = api_client.delete(f'/api/v1/me/notifications/{uuid.uuid4()}')
    assert response.status_code == 204
    assert response.content == b''
