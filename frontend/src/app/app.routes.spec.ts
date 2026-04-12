import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { adminGuard } from './guards/admin.guard';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';
import { routes } from './app.routes';

describe('routes', () => {
  it('protects gallery (root) with authGuard', () => {
    const homeRoute = routes.find((route) => route.path === '');

    expect(homeRoute?.canActivate).toEqual([authGuard]);
  });

  it('protects the authenticated pages', () => {
    const protectedPaths = ['browse', 'album', 'album/:albumId', 'favorites', 'tags', 'trash'];

    for (const path of protectedPaths) {
      const route = routes.find((candidate) => candidate.path === path);
      expect(route?.canActivate).toEqual([authGuard]);
    }
  });

  it('keeps login guest-only', () => {
    const loginRoute = routes.find((route) => route.path === 'login');

    expect(loginRoute?.canActivate).toEqual([guestGuard]);
  });

  it('protects admin with adminGuard', () => {
    const adminRoute = routes.find((route) => route.path === 'admin');

    expect(adminRoute?.canActivate).toEqual([adminGuard]);
  });
});
