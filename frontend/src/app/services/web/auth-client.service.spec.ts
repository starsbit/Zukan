import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthClientService } from './auth-client.service';
import { API_BASE_URL } from './api.config';

describe('AuthClientService', () => {
  let service: AuthClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(AuthClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('register sends POST with body', () => {
    const body = { username: 'saber', email: 'saber@test.com', password: 'password123' };
    const mock = { id: 'u1', username: 'saber', email: 'saber@test.com', show_nsfw: false, tag_confidence_threshold: 0.35, version: 1, created_at: '2026-01-01T00:00:00Z' };

    service.register(body).subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/auth/register');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush(mock);
  });

  it('login sends form-encoded POST', () => {
    const body = { username: 'saber', password: 'password123', remember_me: false };
    const mock = { access_token: 'a', refresh_token: 'r', token_type: 'bearer' };

    service.login(body).subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(req.request.body).toContain('username=saber');
    req.flush(mock);
  });

  it('refresh sends POST with refresh token', () => {
    const body = { refresh_token: 'old-token' };
    const mock = { access_token: 'new-a', refresh_token: 'new-r', token_type: 'bearer' };

    service.refresh(body).subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/auth/refresh');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush(mock);
  });

  it('logout sends POST with refresh token', () => {
    const body = { refresh_token: 'old-token' };

    service.logout(body).subscribe();

    const req = http.expectOne('/api/v1/auth/logout');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush(null, { status: 204, statusText: 'No Content' });
  });
});
