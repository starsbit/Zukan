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
});
