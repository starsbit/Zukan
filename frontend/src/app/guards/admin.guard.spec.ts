import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { adminGuard } from './admin.guard';
import { UserStore } from '../services/user.store';
import { AuthStore } from '../services/web/auth.store';

describe('adminGuard', () => {
  it('allows admins through', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: UserStore, useValue: { isAdmin: () => true } },
        { provide: Router, useValue: { parseUrl: vi.fn() } },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      adminGuard({} as never, { url: '/admin' } as never),
    );

    expect(result).toBe(true);
  });

  it('redirects guests to login with a returnUrl', () => {
    const redirect = { redirectedTo: '/login?returnUrl=%2Fadmin' };
    const parseUrl = vi.fn(() => redirect);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => false } },
        { provide: UserStore, useValue: { isAdmin: () => false } },
        { provide: Router, useValue: { parseUrl } },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      adminGuard({} as never, { url: '/admin' } as never),
    );

    expect(parseUrl).toHaveBeenCalledWith('/login?returnUrl=%2Fadmin');
    expect(result).toBe(redirect);
  });

  it('redirects authenticated non-admin users home', () => {
    const redirect = { redirectedTo: '/' };
    const parseUrl = vi.fn(() => redirect);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: UserStore, useValue: { isAdmin: () => false } },
        { provide: Router, useValue: { parseUrl } },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      adminGuard({} as never, { url: '/admin' } as never),
    );

    expect(parseUrl).toHaveBeenCalledWith('/');
    expect(result).toBe(redirect);
  });
});
