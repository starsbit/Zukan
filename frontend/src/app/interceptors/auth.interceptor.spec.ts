import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthStore, LOCAL_STORAGE, SESSION_STORAGE } from '../services/web/auth.store';
import { API_BASE_URL } from '../services/web/api.config';

const mockTokens = { access_token: 'new-at', refresh_token: 'new-rt', token_type: 'bearer' };

function createStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authStore: AuthStore;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: API_BASE_URL, useValue: '' },
        { provide: LOCAL_STORAGE, useFactory: createStorage },
        { provide: SESSION_STORAGE, useFactory: createStorage },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    authStore = TestBed.inject(AuthStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => httpMock.verify());

  it('attaches Authorization header when access token is present', () => {
    authStore.setTokens({ access_token: 'my-token', refresh_token: 'rt', token_type: 'bearer' }, false);

    http.get('/api/v1/media').subscribe();

    const req = httpMock.expectOne('/api/v1/media');
    expect(req.request.headers.get('Authorization')).toBe('Bearer my-token');
    req.flush([]);
  });

  it('does not attach Authorization header when no token', () => {
    http.get('/api/v1/media').subscribe();

    const req = httpMock.expectOne('/api/v1/media');
    expect(req.request.headers.get('Authorization')).toBeNull();
    req.flush([]);
  });

  it('skips auth endpoints - no header added', () => {
    authStore.setTokens({ access_token: 'my-token', refresh_token: 'rt', token_type: 'bearer' }, false);

    http.post('/api/v1/auth/login', {}).subscribe();

    const req = httpMock.expectOne('/api/v1/auth/login');
    expect(req.request.headers.get('Authorization')).toBeNull();
    req.flush(mockTokens);
  });

  it('on 401, refreshes token and retries original request', () => {
    authStore.setTokens({ access_token: 'expired-at', refresh_token: 'valid-rt', token_type: 'bearer' }, false);
    const results: unknown[] = [];

    http.get('/api/v1/me').subscribe(r => results.push(r));

    const original = httpMock.expectOne('/api/v1/me');
    expect(original.request.headers.get('Authorization')).toBe('Bearer expired-at');
    original.flush({ code: 'not_authenticated' }, { status: 401, statusText: 'Unauthorized' });

    const refresh = httpMock.expectOne('/api/v1/auth/refresh');
    expect(refresh.request.body).toEqual({ refresh_token: 'valid-rt' });
    refresh.flush(mockTokens);

    const retry = httpMock.expectOne('/api/v1/me');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new-at');
    retry.flush({ id: 'u1' });

    expect(results).toEqual([{ id: 'u1' }]);
  });

  it('on 401, stores new tokens after successful refresh', () => {
    authStore.setTokens({ access_token: 'expired-at', refresh_token: 'valid-rt', token_type: 'bearer' }, true);

    http.get('/api/v1/me').subscribe();
    httpMock.expectOne('/api/v1/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    httpMock.expectOne('/api/v1/auth/refresh').flush(mockTokens);
    httpMock.expectOne('/api/v1/me').flush({});

    expect(authStore.getAccessToken()).toBe('new-at');
    expect(authStore.getRefreshToken()).toBe('new-rt');
  });

  it('on 401 with no refresh token, clears store and navigates to /login', () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    http.get('/api/v1/me').subscribe({ error: () => {} });
    httpMock.expectOne('/api/v1/me').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(authStore.getAccessToken()).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('on 401 with failing refresh, clears store and navigates to /login', () => {
    authStore.setTokens({ access_token: 'expired', refresh_token: 'bad-rt', token_type: 'bearer' }, false);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    http.get('/api/v1/me').subscribe({ error: () => {} });
    httpMock.expectOne('/api/v1/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    httpMock.expectOne('/api/v1/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(authStore.getAccessToken()).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('concurrent 401s only trigger one refresh', () => {
    authStore.setTokens({ access_token: 'expired', refresh_token: 'rt', token_type: 'bearer' }, false);

    http.get('/api/v1/me').subscribe();
    http.get('/api/v1/tags').subscribe();

    const [req1, req2] = httpMock.match(r => r.url === '/api/v1/me' || r.url === '/api/v1/tags');
    req1.flush({}, { status: 401, statusText: 'Unauthorized' });
    req2.flush({}, { status: 401, statusText: 'Unauthorized' });

    const refreshReqs = httpMock.match('/api/v1/auth/refresh');
    expect(refreshReqs.length).toBe(1);
    refreshReqs[0].flush(mockTokens);

    httpMock.expectOne('/api/v1/me').flush({});
    httpMock.expectOne('/api/v1/tags').flush([]);
  });

  it('non-401 errors pass through without refresh attempt', () => {
    authStore.setTokens({ access_token: 'at', refresh_token: 'rt', token_type: 'bearer' }, false);
    let caughtStatus = 0;

    http.get('/api/v1/me').subscribe({ error: err => (caughtStatus = err.status) });
    httpMock.expectOne('/api/v1/me').flush({}, { status: 403, statusText: 'Forbidden' });

    expect(caughtStatus).toBe(403);
    httpMock.expectNone('/api/v1/auth/refresh');
  });
});
