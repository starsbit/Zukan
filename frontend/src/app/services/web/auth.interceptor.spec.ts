import '@angular/compiler';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CLIENT_API_BASE_URL } from './api.config';
import { authInterceptor, AUTH_MODE } from './auth.interceptor';
import { ClientApiService } from './api.service';
import { ClientAuthStore } from './auth.store';

describe('authInterceptor', () => {
  let api: ClientApiService;
  let authStore: ClientAuthStore;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ClientApiService,
        ClientAuthStore,
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: CLIENT_API_BASE_URL, useValue: 'http://api.example.test' }
      ]
    });

    api = TestBed.inject(ClientApiService);
    authStore = TestBed.inject(ClientAuthStore);
    authStore.clearTokens();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    authStore.clearTokens();
  });

  it('attaches the bearer token from the auth store', async () => {
    authStore.setTokens({
      accessToken: 'access-1',
      refreshToken: 'refresh-1'
    });

    const requestPromise = firstValueFrom(api.get('/me'));

    const request = httpTesting.expectOne('http://api.example.test/me');
    expect(request.request.headers.get('Authorization')).toBe('Bearer access-1');
    expect(request.request.context.get(AUTH_MODE)).toBe('required');

    request.flush({ id: '1' });
    await expect(requestPromise).resolves.toEqual({ id: '1' });
  });

  it('refreshes on 401 and retries the original request once', async () => {
    authStore.setTokens({
      accessToken: 'expired-access',
      refreshToken: 'refresh-1',
      tokenType: 'bearer'
    });

    const requestPromise = firstValueFrom(api.get('/me'));

    const originalRequest = httpTesting.expectOne('http://api.example.test/me');
    expect(originalRequest.request.headers.get('Authorization')).toBe('Bearer expired-access');
    originalRequest.flush({ detail: 'Invalid token' }, { status: 401, statusText: 'Unauthorized' });

    const refreshRequest = httpTesting.expectOne('http://api.example.test/auth/refresh');
    expect(refreshRequest.request.body).toEqual({ refresh_token: 'refresh-1' });
    expect(refreshRequest.request.headers.has('Authorization')).toBe(false);
    refreshRequest.flush({
      access_token: 'fresh-access',
      refresh_token: 'refresh-2',
      token_type: 'bearer'
    });

    const retriedRequest = httpTesting.expectOne('http://api.example.test/me');
    expect(retriedRequest.request.headers.get('Authorization')).toBe('Bearer fresh-access');
    retriedRequest.flush({ id: 'user-1' });

    await expect(requestPromise).resolves.toEqual({ id: 'user-1' });
    expect(authStore.getAccessToken()).toBe('fresh-access');
    expect(authStore.getRefreshToken()).toBe('refresh-2');
  });

  it('clears tokens when refresh fails', async () => {
    authStore.setTokens({
      accessToken: 'expired-access',
      refreshToken: 'refresh-1'
    });

    const requestPromise = firstValueFrom(api.get('/me'));

    const originalRequest = httpTesting.expectOne('http://api.example.test/me');
    originalRequest.flush({ detail: 'Invalid token' }, { status: 401, statusText: 'Unauthorized' });

    const refreshRequest = httpTesting.expectOne('http://api.example.test/auth/refresh');
    refreshRequest.flush({ detail: 'Invalid or expired refresh token' }, { status: 401, statusText: 'Unauthorized' });

    await expect(requestPromise).rejects.toMatchObject({ status: 401 });
    expect(authStore.getAccessToken()).toBeNull();
    expect(authStore.getRefreshToken()).toBeNull();
  });
});
