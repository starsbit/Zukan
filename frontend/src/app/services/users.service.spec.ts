import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { CLIENT_API_BASE_URL } from './web/api.config';
import { AuthClientService } from './web/auth-client.service';
import { ClientAuthStore } from './web/auth.store';
import { UsersClientService } from './web/users-client.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let authService: AuthService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        UsersService,
        UsersClientService,
        AuthService,
        AuthClientService,
        ClientAuthStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CLIENT_API_BASE_URL, useValue: 'http://api.example.test' }
      ]
    });

    service = TestBed.inject(UsersService);
    authService = TestBed.inject(AuthService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('loads the current user and keeps the auth session in sync', async () => {
    const loadPromise = firstValueFrom(service.loadMe());
    expect(service.snapshot.request.loading).toBe(true);

    const request = httpTesting.expectOne('http://api.example.test/users/me');
    request.flush({
      id: 'user-1',
      username: 'rin',
      email: 'rin@example.test',
      is_admin: false,
      show_nsfw: true,
      created_at: '2026-03-21T00:00:00Z'
    });

    await expect(loadPromise).resolves.toMatchObject({ id: 'user-1', show_nsfw: true });
    expect(service.snapshot.profile).toMatchObject({ id: 'user-1', show_nsfw: true });
    expect(authService.snapshot.user).toMatchObject({ id: 'user-1', show_nsfw: true });
  });

  it('updates the current user profile in place', async () => {
    authService.setAuthenticatedUser({
      id: 'user-1',
      username: 'rin',
      email: 'rin@example.test',
      is_admin: false,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    const updatePromise = firstValueFrom(service.updateMe({ show_nsfw: true }));
    expect(service.snapshot.updating).toBe(true);

    const request = httpTesting.expectOne('http://api.example.test/users/me');
    expect(request.request.method).toBe('PATCH');
    request.flush({
      id: 'user-1',
      username: 'rin',
      email: 'rin@example.test',
      is_admin: false,
      show_nsfw: true,
      created_at: '2026-03-21T00:00:00Z'
    });

    await expect(updatePromise).resolves.toMatchObject({ show_nsfw: true });
    expect(service.snapshot.profile?.show_nsfw).toBe(true);
    expect(authService.snapshot.user?.show_nsfw).toBe(true);
  });

  it('refreshes through loadMe and exposes loaded state', async () => {
    const refreshPromise = firstValueFrom(service.refreshMe());
    const request = httpTesting.expectOne('http://api.example.test/users/me');
    request.flush({
      id: 'user-2',
      username: 'refreshed',
      email: 'refreshed@example.test',
      is_admin: false,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    await expect(refreshPromise).resolves.toMatchObject({ id: 'user-2' });
    expect(service.snapshot.request.loaded).toBe(true);
  });

  it('resets profile state when auth becomes anonymous', () => {
    authService.setAuthenticatedUser({
      id: 'user-1',
      username: 'rin',
      email: 'rin@example.test',
      is_admin: false,
      show_nsfw: true,
      created_at: '2026-03-21T00:00:00Z'
    });

    expect(service.snapshot.profile?.id).toBe('user-1');

    authService.clearSessionState();

    expect(service.snapshot.profile).toBeNull();
    expect(service.snapshot.request.loaded).toBe(false);
  });

  it('records errors when loadMe or updateMe fail', async () => {
    const loadPromise = firstValueFrom(service.loadMe());
    const loadRequest = httpTesting.expectOne('http://api.example.test/users/me');
    loadRequest.flush({ detail: 'broken' }, { status: 500, statusText: 'Server Error' });

    await expect(loadPromise).rejects.toMatchObject({ status: 500 });
    expect(service.snapshot.request.error).toMatchObject({ status: 500 });

    authService.setAuthenticatedUser({
      id: 'user-1',
      username: 'rin',
      email: 'rin@example.test',
      is_admin: false,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    const updatePromise = firstValueFrom(service.updateMe({ show_nsfw: true }));
    const updateRequest = httpTesting.expectOne('http://api.example.test/users/me');
    updateRequest.flush({ detail: 'broken' }, { status: 500, statusText: 'Server Error' });

    await expect(updatePromise).rejects.toMatchObject({ status: 500 });
    expect(service.snapshot.updating).toBe(false);
    expect(service.snapshot.request.error).toMatchObject({ status: 500 });
  });
});
