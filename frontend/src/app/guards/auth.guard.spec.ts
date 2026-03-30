import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { authGuard } from './auth.guard';
import { AuthStore } from '../services/web/auth.store';

describe('authGuard', () => {
  it('allows authenticated users through', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: Router, useValue: { parseUrl: vi.fn() } },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/gallery' } as never),
    );

    expect(result).toBe(true);
  });

  it('redirects guests to login with a returnUrl', () => {
    const redirect = { redirectedTo: '/login?returnUrl=%2Fgallery' };
    const parseUrl = vi.fn(() => redirect);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => false } },
        { provide: Router, useValue: { parseUrl } },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/gallery' } as never),
    );

    expect(parseUrl).toHaveBeenCalledWith('/login?returnUrl=%2Fgallery');
    expect(result).toBe(redirect);
  });
});
