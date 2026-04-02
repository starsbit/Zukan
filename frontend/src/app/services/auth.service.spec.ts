import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { UserStore } from './user.store';
import { UploadTrackerService } from './upload-tracker.service';
import { AdminClientService } from './web/admin-client.service';
import { AuthClientService } from './web/auth-client.service';
import { AuthStore } from './web/auth.store';
import { UsersClientService } from './web/users-client.service';

describe('AuthService', () => {
  it('resets upload tracking after a successful login', async () => {
    const authClient = {
      login: vi.fn(() => of({
        access_token: 'access',
        refresh_token: 'refresh',
        token_type: 'bearer',
      })),
      register: vi.fn(),
      logout: vi.fn(),
    };
    const usersClient = {
      getMe: vi.fn(() => of({
        id: 'u1',
        username: 'stars',
        email: 'stars@example.com',
        is_admin: false,
        show_nsfw: false,
        tag_confidence_threshold: 0.5,
        version: 1,
        created_at: '2026-04-02T10:00:00Z',
      })),
    };
    const authStore = {
      setTokens: vi.fn(),
      getRefreshToken: vi.fn(() => null),
      clear: vi.fn(),
    };
    const userStore = {
      set: vi.fn(),
      clear: vi.fn(),
    };
    const uploadTracker = {
      reset: vi.fn(),
    };
    const router = {
      navigate: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: AuthClientService, useValue: authClient },
        { provide: UsersClientService, useValue: usersClient },
        { provide: AdminClientService, useValue: { updateUser: vi.fn(), deleteUser: vi.fn() } },
        { provide: AuthStore, useValue: authStore },
        { provide: UserStore, useValue: userStore },
        { provide: UploadTrackerService, useValue: uploadTracker },
        { provide: Router, useValue: router },
      ],
    });

    const service = TestBed.inject(AuthService);
    await new Promise<void>((resolve, reject) => {
      service.login('stars', 'secret', true).subscribe({
        next: () => resolve(),
        error: reject,
      });
    });

    expect(authStore.setTokens).toHaveBeenCalledTimes(1);
    expect(uploadTracker.reset).toHaveBeenCalledTimes(1);
    expect(userStore.set).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
  });

  it('resets upload tracking during logout cleanup', async () => {
    const authClient = {
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(() => of(void 0)),
    };
    const authStore = {
      setTokens: vi.fn(),
      getRefreshToken: vi.fn(() => 'refresh'),
      clear: vi.fn(),
    };
    const userStore = {
      set: vi.fn(),
      clear: vi.fn(),
    };
    const uploadTracker = {
      reset: vi.fn(),
    };
    const router = {
      navigate: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: AuthClientService, useValue: authClient },
        { provide: UsersClientService, useValue: { getMe: vi.fn() } },
        { provide: AdminClientService, useValue: { updateUser: vi.fn(), deleteUser: vi.fn() } },
        { provide: AuthStore, useValue: authStore },
        { provide: UserStore, useValue: userStore },
        { provide: UploadTrackerService, useValue: uploadTracker },
        { provide: Router, useValue: router },
      ],
    });

    const service = TestBed.inject(AuthService);
    await new Promise<void>((resolve, reject) => {
      service.logout().subscribe({
        next: () => resolve(),
        error: reject,
      });
    });

    expect(authClient.logout).toHaveBeenCalledWith({ refresh_token: 'refresh' });
    expect(uploadTracker.reset).toHaveBeenCalledTimes(1);
    expect(authStore.clear).toHaveBeenCalledTimes(1);
    expect(userStore.clear).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});
