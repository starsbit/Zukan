import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CLIENT_API_BASE_URL } from './api.config';
import { AuthClientService } from './auth-client.service';
import { ClientAuthStore } from './auth.store';

describe('AuthClientService', () => {
  let service: AuthClientService;
  let authStore: ClientAuthStore;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthClientService,
        ClientAuthStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CLIENT_API_BASE_URL, useValue: 'http://api.example.test' }
      ]
    });

    service = TestBed.inject(AuthClientService);
    authStore = TestBed.inject(ClientAuthStore);
    authStore.clearTokens();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    authStore.clearTokens();
  });

  it('stores tokens on login', async () => {
    const loginPromise = firstValueFrom(service.login({
      username: 'admin',
      password: 'secret'
    }));

    const request = httpTesting.expectOne('http://api.example.test/auth/login');
    expect(request.request.method).toBe('POST');
    request.flush({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      token_type: 'bearer'
    });

    await expect(loginPromise).resolves.toMatchObject({ access_token: 'access-1' });
    expect(authStore.getAccessToken()).toBe('access-1');
    expect(authStore.getRefreshToken()).toBe('refresh-1');
    expect(authStore.getTokenType()).toBe('bearer');
  });

  it('uses the stored refresh token and replaces both tokens on refresh', async () => {
    authStore.setTokens({
      accessToken: 'stale-access',
      refreshToken: 'refresh-1',
      tokenType: 'bearer'
    });

    const refreshPromise = firstValueFrom(service.refresh());

    const request = httpTesting.expectOne('http://api.example.test/auth/refresh');
    expect(request.request.body).toEqual({ refresh_token: 'refresh-1' });
    request.flush({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      token_type: 'bearer'
    });

    await expect(refreshPromise).resolves.toMatchObject({ access_token: 'access-2' });
    expect(authStore.getAccessToken()).toBe('access-2');
    expect(authStore.getRefreshToken()).toBe('refresh-2');
  });

  it('clears stored tokens on logout', async () => {
    authStore.setTokens({
      accessToken: 'access-1',
      refreshToken: 'refresh-1'
    });

    const logoutPromise = firstValueFrom(service.logout());

    const request = httpTesting.expectOne('http://api.example.test/auth/logout');
    expect(request.request.body).toEqual({ refresh_token: 'refresh-1' });
    request.flush(null, { status: 204, statusText: 'No Content' });

    await expect(logoutPromise).resolves.toBeNull();
    expect(authStore.getAccessToken()).toBeNull();
    expect(authStore.getRefreshToken()).toBeNull();
  });
});
