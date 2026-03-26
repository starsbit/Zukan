import '@angular/compiler';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CLIENT_API_BASE_URL } from './api.config';
import { AuthClientService } from './auth-client.service';

describe('AuthClientService', () => {
  let service: AuthClientService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthClientService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CLIENT_API_BASE_URL, useValue: 'http://api.example.test' }
      ]
    });

    service = TestBed.inject(AuthClientService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('sends login credentials as form-encoded and returns token response', async () => {
    const loginPromise = firstValueFrom(service.login({
      username: 'admin',
      password: 'secret',
      remember_me: true
    }));

    const request = httpTesting.expectOne('http://api.example.test/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Content-Type')).toContain('application/x-www-form-urlencoded');
    expect(request.request.body).toBe('username=admin&password=secret&remember_me=true');
    request.flush({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      token_type: 'bearer'
    });

    await expect(loginPromise).resolves.toMatchObject({ access_token: 'access-1' });
  });

  it('registers without auth and returns the created user', async () => {
    const registerPromise = firstValueFrom(service.register({
      username: 'new-user',
      email: 'new-user@example.test',
      password: 'secret'
    }));

    const request = httpTesting.expectOne('http://api.example.test/auth/register');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      username: 'new-user',
      email: 'new-user@example.test',
      password: 'secret'
    });
    request.flush({ id: 'user-2', username: 'new-user', email: 'new-user@example.test' });

    await expect(registerPromise).resolves.toEqual({ id: 'user-2', username: 'new-user', email: 'new-user@example.test' });
  });

  it('sends the provided refresh token and returns new tokens', async () => {
    const refreshPromise = firstValueFrom(service.refresh({ refresh_token: 'refresh-1' }));

    const request = httpTesting.expectOne('http://api.example.test/auth/refresh');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ refresh_token: 'refresh-1' });
    request.flush({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      token_type: 'bearer'
    });

    await expect(refreshPromise).resolves.toMatchObject({ access_token: 'access-2' });
  });

  it('sends the provided refresh token on logout', async () => {
    const logoutPromise = firstValueFrom(service.logout({ refresh_token: 'refresh-1' }));

    const request = httpTesting.expectOne('http://api.example.test/auth/logout');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ refresh_token: 'refresh-1' });
    request.flush(null, { status: 204, statusText: 'No Content' });

    await expect(logoutPromise).resolves.toBeNull();
  });
});
