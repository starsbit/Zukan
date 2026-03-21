import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CLIENT_API_BASE_URL } from './web/api.config';
import { AuthClientService } from './web/auth-client.service';
import { ClientAuthStore } from './web/auth.store';
import { UsersClientService } from './web/users-client.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let authStore: ClientAuthStore;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        AuthClientService,
        UsersClientService,
        ClientAuthStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CLIENT_API_BASE_URL, useValue: 'http://api.example.test' }
      ]
    });

    service = TestBed.inject(AuthService);
    authStore = TestBed.inject(ClientAuthStore);
    authStore.clearTokens();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    authStore.clearTokens();
  });

  it('logs in, loads the current user, and publishes authenticated state', async () => {
    const loginPromise = firstValueFrom(service.login({
      username: 'admin',
      password: 'secret'
    }));

    expect(service.snapshot.loginPending).toBe(true);

    const loginRequest = httpTesting.expectOne('http://api.example.test/auth/login');
    loginRequest.flush({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      token_type: 'bearer'
    });

    const meRequest = httpTesting.expectOne('http://api.example.test/users/me');
    meRequest.flush({
      id: 'user-1',
      username: 'admin',
      email: 'admin@example.test',
      is_admin: true,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    await expect(loginPromise).resolves.toMatchObject({ id: 'user-1', is_admin: true });
    expect(service.snapshot.user).toMatchObject({ id: 'user-1', is_admin: true });
    expect(service.snapshot.status).toBe('authenticated');
    expect(authStore.getAccessToken()).toBe('access-1');
  });

  it('registers a user, then logs in and publishes authenticated state', async () => {
    const registerPromise = firstValueFrom(service.register({
      username: 'new-user',
      email: 'new-user@example.test',
      password: 'password123'
    }));

    expect(service.snapshot.loginPending).toBe(true);

    const registerRequest = httpTesting.expectOne('http://api.example.test/auth/register');
    registerRequest.flush({
      id: 'user-2',
      username: 'new-user',
      email: 'new-user@example.test',
      is_admin: false,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    const loginRequest = httpTesting.expectOne('http://api.example.test/auth/login');
    expect(loginRequest.request.body).toEqual({
      username: 'new-user',
      password: 'password123'
    });
    loginRequest.flush({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      token_type: 'bearer'
    });

    const meRequest = httpTesting.expectOne('http://api.example.test/users/me');
    meRequest.flush({
      id: 'user-2',
      username: 'new-user',
      email: 'new-user@example.test',
      is_admin: false,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    await expect(registerPromise).resolves.toMatchObject({ id: 'user-2', username: 'new-user' });
    expect(service.snapshot.user?.id).toBe('user-2');
    expect(service.snapshot.status).toBe('authenticated');
    expect(authStore.getAccessToken()).toBe('access-2');
  });

  it('logs out and clears authenticated state', async () => {
    authStore.setTokens({
      accessToken: 'access-1',
      refreshToken: 'refresh-1'
    });
    service.setAuthenticatedUser({
      id: 'user-1',
      username: 'admin',
      email: 'admin@example.test',
      is_admin: true,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    const logoutPromise = firstValueFrom(service.logout());
    expect(service.snapshot.logoutPending).toBe(true);

    const logoutRequest = httpTesting.expectOne('http://api.example.test/auth/logout');
    expect(logoutRequest.request.body).toEqual({ refresh_token: 'refresh-1' });
    logoutRequest.flush(null, { status: 204, statusText: 'No Content' });

    await expect(logoutPromise).resolves.toBeNull();
    expect(service.snapshot.user).toBeNull();
    expect(service.snapshot.status).toBe('anonymous');
    expect(authStore.getAccessToken()).toBeNull();
  });

  it('loads the current user and clears the session on failure', async () => {
    service.setAuthenticatedUser({
      id: 'user-1',
      username: 'admin',
      email: 'admin@example.test',
      is_admin: true,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    const loadPromise = firstValueFrom(service.loadCurrentUser());
    const request = httpTesting.expectOne('http://api.example.test/users/me');
    request.flush({ detail: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    await expect(loadPromise).rejects.toMatchObject({ status: 401 });
    expect(service.snapshot.user).toBeNull();
    expect(service.snapshot.status).toBe('anonymous');
    expect(service.snapshot.initialized).toBe(true);
    expect(service.snapshot.error).toMatchObject({ status: 401 });
  });

  it('refreshes the session and republishes the current user', async () => {
    authStore.setTokens({
      accessToken: 'stale-access',
      refreshToken: 'refresh-1'
    });

    const refreshPromise = firstValueFrom(service.refreshSession());
    expect(service.snapshot.refreshPending).toBe(true);

    const refreshRequest = httpTesting.expectOne('http://api.example.test/auth/refresh');
    refreshRequest.flush({
      access_token: 'fresh-access',
      refresh_token: 'refresh-2',
      token_type: 'bearer'
    });

    const meRequest = httpTesting.expectOne('http://api.example.test/users/me');
    meRequest.flush({
      id: 'user-2',
      username: 'refreshed',
      email: 'refresh@example.test',
      is_admin: false,
      show_nsfw: true,
      created_at: '2026-03-21T00:00:00Z'
    });

    await expect(refreshPromise).resolves.toMatchObject({ id: 'user-2', show_nsfw: true });
    expect(service.snapshot.user?.id).toBe('user-2');
    expect(authStore.getAccessToken()).toBe('fresh-access');
    expect(authStore.getRefreshToken()).toBe('refresh-2');
  });

  it('retains the current user and records an error when logout fails', async () => {
    authStore.setTokens({
      accessToken: 'access-1',
      refreshToken: 'refresh-1'
    });
    service.setAuthenticatedUser({
      id: 'user-1',
      username: 'admin',
      email: 'admin@example.test',
      is_admin: true,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    const logoutPromise = firstValueFrom(service.logout());
    const logoutRequest = httpTesting.expectOne('http://api.example.test/auth/logout');
    logoutRequest.flush({ detail: 'Server error' }, { status: 500, statusText: 'Server Error' });

    await expect(logoutPromise).rejects.toMatchObject({ status: 500 });
    expect(service.snapshot.user?.id).toBe('user-1');
    expect(service.snapshot.error).toMatchObject({ status: 500 });
    expect(service.snapshot.logoutPending).toBe(false);
  });
});
