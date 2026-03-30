import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { guestGuard } from './guest.guard';
import { AuthStore } from '../services/web/auth.store';

describe('guestGuard', () => {
  it('allows guests through', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => false } },
        { provide: Router, useValue: { parseUrl: vi.fn() } },
      ],
    });

    const result = TestBed.runInInjectionContext(() => guestGuard({} as never, {} as never));

    expect(result).toBe(true);
  });

  it('redirects authenticated users to home', () => {
    const redirect = { redirectedTo: '/' };
    const parseUrl = vi.fn(() => redirect);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: Router, useValue: { parseUrl } },
      ],
    });

    const result = TestBed.runInInjectionContext(() => guestGuard({} as never, {} as never));

    expect(parseUrl).toHaveBeenCalledWith('/');
    expect(result).toBe(redirect);
  });
});
