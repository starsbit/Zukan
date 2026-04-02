import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UsersClientService } from './users-client.service';
import { API_BASE_URL } from './api.config';

const mockUser = {
  id: 'u1', username: 'saber', email: 'saber@test.com',
  is_admin: false, show_nsfw: false, tag_confidence_threshold: 0.35,
  version: 1, created_at: '2026-01-01T00:00:00Z',
};

const mockApiKeyStatus = {
  has_key: true,
  created_at: '2026-04-02T09:15:00Z',
  last_used_at: '2026-04-02T10:30:00Z',
};

describe('UsersClientService', () => {
  let service: UsersClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(UsersClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('getMe sends GET /api/v1/me', () => {
    service.getMe().subscribe(res => expect(res).toEqual(mockUser));

    const req = http.expectOne('/api/v1/me');
    expect(req.request.method).toBe('GET');
    req.flush(mockUser);
  });

  it('updateMe sends PATCH /api/v1/me with body', () => {
    const update = { show_nsfw: true, version: 1 };

    service.updateMe(update).subscribe(res => expect(res).toEqual(mockUser));

    const req = http.expectOne('/api/v1/me');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(update);
    req.flush(mockUser);
  });

  it('getApiKeyStatus sends GET /api/v1/me/api-key', () => {
    service.getApiKeyStatus().subscribe(res => expect(res).toEqual(mockApiKeyStatus));

    const req = http.expectOne('/api/v1/me/api-key');
    expect(req.request.method).toBe('GET');
    req.flush(mockApiKeyStatus);
  });

  it('createApiKey sends POST /api/v1/me/api-key', () => {
    const created = { ...mockApiKeyStatus, api_key: 'zk_test_key' };

    service.createApiKey().subscribe(res => expect(res).toEqual(created));

    const req = http.expectOne('/api/v1/me/api-key');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(created);
  });
});
