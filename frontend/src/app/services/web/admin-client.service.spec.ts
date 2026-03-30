import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminClientService } from './admin-client.service';
import { API_BASE_URL } from './api.config';

const mockUser = {
  id: 'u1', username: 'saber', email: 'saber@test.com',
  is_admin: false, show_nsfw: false, tag_confidence_threshold: 0.35,
  version: 1, created_at: '2026-01-01T00:00:00Z',
};
const mockUserDetail = { ...mockUser, media_count: 10, storage_used_bytes: 1024 };
const mockStats = { total_users: 1, total_media: 5, total_storage_bytes: 5120, pending_tagging: 0, failed_tagging: 0, trashed_media: 0 };
const mockUserPage = { total: 1, page: 1, page_size: 20, items: [mockUser] };

describe('AdminClientService', () => {
  let service: AdminClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(AdminClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('getStats sends GET /api/v1/admin/stats', () => {
    service.getStats().subscribe(res => expect(res).toEqual(mockStats));

    const req = http.expectOne('/api/v1/admin/stats');
    expect(req.request.method).toBe('GET');
    req.flush(mockStats);
  });

  it('listUsers sends GET /api/v1/admin/users', () => {
    service.listUsers().subscribe(res => expect(res).toEqual(mockUserPage));

    const req = http.expectOne('/api/v1/admin/users');
    expect(req.request.method).toBe('GET');
    req.flush(mockUserPage);
  });

  it('listUsers passes page and sort params', () => {
    service.listUsers({ page: 2, page_size: 10, sort_by: 'username' }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/admin/users');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('page_size')).toBe('10');
    expect(req.request.params.get('sort_by')).toBe('username');
    req.flush(mockUserPage);
  });

  it('getUser sends GET /api/v1/admin/users/{id}', () => {
    service.getUser('u1').subscribe(res => expect(res).toEqual(mockUserDetail));

    const req = http.expectOne('/api/v1/admin/users/u1');
    expect(req.request.method).toBe('GET');
    req.flush(mockUserDetail);
  });

  it('updateUser sends PATCH /api/v1/admin/users/{id}', () => {
    const body = { is_admin: true };

    service.updateUser('u1', body).subscribe(res => expect(res).toEqual(mockUser));

    const req = http.expectOne('/api/v1/admin/users/u1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(body);
    req.flush(mockUser);
  });

  it('deleteUser sends DELETE /api/v1/admin/users/{id}', () => {
    service.deleteUser('u1').subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/admin/users/u1');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.params.get('delete_media')).toBe('false');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('deleteUser passes delete_media=true when requested', () => {
    service.deleteUser('u1', true).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/admin/users/u1');
    expect(req.request.params.get('delete_media')).toBe('true');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('retagAll sends POST /api/v1/admin/users/{id}/tagging-jobs', () => {
    const mock = { queued: 5 };

    service.retagAll('u1').subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/admin/users/u1/tagging-jobs');
    expect(req.request.method).toBe('POST');
    req.flush(mock);
  });

  it('listAnnouncements sends GET /api/v1/admin/announcements', () => {
    const mock = [{ id: 'ann1', title: 'Update', message: 'New version', severity: 'info' as const, is_active: true, created_at: '2026-01-01T00:00:00Z', version: null, starts_at: null, ends_at: null }];

    service.listAnnouncements().subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/admin/announcements');
    expect(req.request.method).toBe('GET');
    req.flush(mock);
  });

  it('createAnnouncement sends POST /api/v1/admin/announcements', () => {
    const body = { title: 'Maintenance', message: 'Scheduled downtime' };
    const mock = { id: 'ann1', title: 'Maintenance', message: 'Scheduled downtime', severity: 'info' as const, is_active: true, created_at: '2026-01-01T00:00:00Z', version: null, starts_at: null, ends_at: null };

    service.createAnnouncement(body).subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/admin/announcements');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush(mock);
  });
});
