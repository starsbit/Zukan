import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NotificationsClientService } from './notifications-client.service';
import { API_BASE_URL } from './api.config';

const mockNotifPage = { total: 0, next_cursor: null, has_more: false, page_size: 20, items: [] };
const mockNotif = {
  id: 'n1', user_id: 'u1', type: 'batch_done' as const,
  title: 'Done', body: 'Upload complete', is_read: false,
  link_url: null, data: null, created_at: '2026-01-01T00:00:00Z',
};

describe('NotificationsClientService', () => {
  let service: NotificationsClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(NotificationsClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list sends GET /api/v1/me/notifications', () => {
    service.list().subscribe(res => expect(res).toEqual(mockNotifPage));

    const req = http.expectOne('/api/v1/me/notifications');
    expect(req.request.method).toBe('GET');
    req.flush(mockNotifPage);
  });

  it('list passes is_read filter param', () => {
    service.list({ is_read: false }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/me/notifications');
    expect(req.request.params.get('is_read')).toBe('false');
    req.flush(mockNotifPage);
  });

  it('markRead sends PATCH /api/v1/me/notifications/{id}/read', () => {
    service.markRead('n1').subscribe(res => expect(res).toEqual(mockNotif));

    const req = http.expectOne('/api/v1/me/notifications/n1/read');
    expect(req.request.method).toBe('PATCH');
    req.flush(mockNotif);
  });

  it('markAllRead sends POST /api/v1/me/notifications/read-all', () => {
    service.markAllRead().subscribe();

    const req = http.expectOne('/api/v1/me/notifications/read-all');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('acceptInvite sends POST /api/v1/me/notifications/{id}/accept', () => {
    service.acceptInvite('n1').subscribe(res => expect(res).toEqual(mockNotif));

    const req = http.expectOne('/api/v1/me/notifications/n1/accept');
    expect(req.request.method).toBe('POST');
    req.flush(mockNotif);
  });

  it('rejectInvite sends POST /api/v1/me/notifications/{id}/reject', () => {
    service.rejectInvite('n1').subscribe(res => expect(res).toEqual(mockNotif));

    const req = http.expectOne('/api/v1/me/notifications/n1/reject');
    expect(req.request.method).toBe('POST');
    req.flush(mockNotif);
  });

  it('delete sends DELETE /api/v1/me/notifications/{id}', () => {
    service.delete('n1').subscribe();

    const req = http.expectOne('/api/v1/me/notifications/n1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });
});
