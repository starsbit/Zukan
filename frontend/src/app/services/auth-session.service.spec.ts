import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthSessionService } from './auth-session.service';
import { UserStore } from './user.store';
import { AuthStore, LOCAL_STORAGE, SESSION_STORAGE } from './web/auth.store';

const mockTokens = { access_token: 'access-abc', refresh_token: 'refresh-xyz', token_type: 'bearer' };
const mockUser = {
  id: 'u1',
  username: 'saber',
  email: 'saber@example.com',
  is_admin: false,
  show_nsfw: false,
  tag_confidence_threshold: 0.5,
  version: 1,
  created_at: '2026-01-01T00:00:00Z',
};

function createStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => {
      store[k] = v;
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      Object.keys(store).forEach(k => delete store[k]);
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}

describe('AuthSessionService', () => {
  let authStore: AuthStore;
  let userStore: { load: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    userStore = {
      load: vi.fn(() => of(mockUser)),
      clear: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AuthSessionService,
        AuthStore,
        { provide: LOCAL_STORAGE, useFactory: createStorage },
        { provide: SESSION_STORAGE, useFactory: createStorage },
        { provide: UserStore, useValue: userStore },
      ],
    });

    authStore = TestBed.inject(AuthStore);
  });

  it('does not load the current user when there is no stored session', async () => {
    const service = TestBed.inject(AuthSessionService);

    await service.restore();

    expect(userStore.load).not.toHaveBeenCalled();
  });

  it('loads the current user when a remembered session is already stored', async () => {
    authStore.setTokens(mockTokens, true);
    const service = TestBed.inject(AuthSessionService);

    await service.restore();

    expect(userStore.load).toHaveBeenCalledTimes(1);
    expect(authStore.isAuthenticated()).toBe(true);
  });

  it('clears the stored session when restoring the current user fails', async () => {
    authStore.setTokens(mockTokens, true);
    userStore.load.mockReturnValue(throwError(() => new Error('boom')));
    const service = TestBed.inject(AuthSessionService);

    await service.restore();

    expect(userStore.load).toHaveBeenCalledTimes(1);
    expect(userStore.clear).toHaveBeenCalledTimes(1);
    expect(authStore.isAuthenticated()).toBe(false);
    expect(authStore.getAccessToken()).toBeNull();
    expect(authStore.getRefreshToken()).toBeNull();
  });
});
