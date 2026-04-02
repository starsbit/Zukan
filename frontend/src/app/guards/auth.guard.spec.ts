import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { authGuard } from './auth.guard';
import { AuthStore } from '../services/web/auth.store';
import { ConfigClientService } from '../services/web/config-client.service';

describe('authGuard', () => {
  it('allows authenticated users through', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: Router, useValue: { parseUrl: vi.fn() } },
        { provide: ConfigClientService, useValue: { getSetupRequired: vi.fn() } },
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
        { provide: ConfigClientService, useValue: { getSetupRequired: vi.fn() } },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/gallery' } as never),
    );

    expect(parseUrl).toHaveBeenCalledWith('/login?returnUrl=%2Fgallery');
    expect(result).toBe(redirect);
  });

  it('allows guests onto home while setup is required', async () => {
    const parseUrl = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => false } },
        { provide: Router, useValue: { parseUrl } },
        { provide: ConfigClientService, useValue: { getSetupRequired: vi.fn(() => of({ setup_required: true })) } },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/' } as never),
    );

    await expect(firstValueFrom(result as Observable<unknown>)).resolves.toBe(true);
    expect(parseUrl).not.toHaveBeenCalled();
  });

  it('redirects guests from home when setup check fails', async () => {
    const redirect = { redirectedTo: '/login?returnUrl=%2F' };
    const parseUrl = vi.fn(() => redirect);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => false } },
        { provide: Router, useValue: { parseUrl } },
        { provide: ConfigClientService, useValue: { getSetupRequired: vi.fn(() => throwError(() => new Error('boom'))) } },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/' } as never),
    );

    await expect(firstValueFrom(result as Observable<unknown>)).resolves.toBe(redirect);
    expect(parseUrl).toHaveBeenCalledWith('/login?returnUrl=%2F');
  });
});
