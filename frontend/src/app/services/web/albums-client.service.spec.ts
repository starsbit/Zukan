import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AlbumsClientService } from './albums-client.service';
import { API_BASE_URL } from './api.config';
import { AlbumAccessRole, AlbumShareRole, AlbumShareReadRole } from '../../models/albums';

const mockAlbum = {
  id: 'a1', owner_id: 'u1', name: 'Test', description: null,
  owner: { id: 'u1', username: 'owner' }, access_role: AlbumAccessRole.OWNER,
  cover_media_id: null, preview_media: [], media_count: 0, version: 1,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
const mockPage = { total: 0, next_cursor: null, has_more: false, page_size: 20, items: [] };

describe('AlbumsClientService', () => {
  let service: AlbumsClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(AlbumsClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list sends GET /api/v1/albums', () => {
    service.list().subscribe(res => expect(res).toEqual(mockPage));

    const req = http.expectOne('/api/v1/albums');
    expect(req.request.method).toBe('GET');
    req.flush(mockPage);
  });

  it('list passes sort params', () => {
    service.list({ sort_by: 'name', sort_order: 'asc' }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/albums');
    expect(req.request.params.get('sort_by')).toBe('name');
    expect(req.request.params.get('sort_order')).toBe('asc');
    req.flush(mockPage);
  });

  it('create sends POST /api/v1/albums', () => {
    const body = { name: 'New Album' };

    service.create(body).subscribe(res => expect(res).toEqual(mockAlbum));

    const req = http.expectOne('/api/v1/albums');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush(mockAlbum);
  });

  it('get sends GET /api/v1/albums/{id}', () => {
    service.get('a1').subscribe(res => expect(res).toEqual(mockAlbum));

    const req = http.expectOne('/api/v1/albums/a1');
    expect(req.request.method).toBe('GET');
    req.flush(mockAlbum);
  });

  it('update sends PATCH /api/v1/albums/{id}', () => {
    const body = { name: 'Renamed', version: 1 };

    service.update('a1', body).subscribe(res => expect(res).toEqual(mockAlbum));

    const req = http.expectOne('/api/v1/albums/a1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(body);
    req.flush(mockAlbum);
  });

  it('delete sends DELETE /api/v1/albums/{id}', () => {
    service.delete('a1').subscribe();

    const req = http.expectOne('/api/v1/albums/a1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('listMedia sends GET /api/v1/albums/{id}/media', () => {
    service.listMedia('a1').subscribe(res => expect(res).toEqual(mockPage));

    const req = http.expectOne('/api/v1/albums/a1/media');
    expect(req.request.method).toBe('GET');
    req.flush(mockPage);
  });

  it('listMedia passes tag filter array params', () => {
    service.listMedia('a1', { tag: ['cat', 'night'] }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/albums/a1/media');
    expect(req.request.params.getAll('tag')).toEqual(['cat', 'night']);
    req.flush(mockPage);
  });

  it('addMedia sends PUT /api/v1/albums/{id}/media', () => {
    const body = { media_ids: ['m1', 'm2'] };
    const mock = { processed: 2, skipped: 0 };

    service.addMedia('a1', body).subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/albums/a1/media');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(body);
    req.flush(mock);
  });

  it('removeMedia sends DELETE /api/v1/albums/{id}/media with body', () => {
    const body = { media_ids: ['m1'] };
    const mock = { processed: 1, skipped: 0 };

    service.removeMedia('a1', body).subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/albums/a1/media');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual(body);
    req.flush(mock);
  });

  it('share sends POST /api/v1/albums/{id}/shares', () => {
    const body = { username: 'viewer_user', role: AlbumShareRole.EDITOR };
    const mock = { user_id: 'u2', role: AlbumShareReadRole.EDITOR, shared_at: '2026-01-01T00:00:00Z', shared_by_user_id: 'u1' };

    service.share('a1', body).subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/albums/a1/shares');
    expect(req.request.method).toBe('POST');
    req.flush(mock);
  });

  it('revokeShare sends DELETE /api/v1/albums/{albumId}/shares/{userId}', () => {
    service.revokeShare('a1', 'u2').subscribe();

    const req = http.expectOne('/api/v1/albums/a1/shares/u2');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('transferOwnership sends POST /api/v1/albums/{id}/owner/transfer', () => {
    const body = { new_owner_user_id: 'u2', keep_editor_access: false };

    service.transferOwnership('a1', body).subscribe(res => expect(res).toEqual(mockAlbum));

    const req = http.expectOne('/api/v1/albums/a1/owner/transfer');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush(mockAlbum);
  });

  it('download sends GET /api/v1/albums/{id}/download and returns blob', () => {
    const blob = new Blob(['data'], { type: 'application/zip' });

    service.download('a1').subscribe(res => expect(res).toBeInstanceOf(Blob));

    const req = http.expectOne('/api/v1/albums/a1/download');
    expect(req.request.method).toBe('GET');
    req.flush(blob);
  });
});
