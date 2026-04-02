import { adminGuard } from './guards/admin.guard';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';
import { routes } from './app.routes';

describe('routes', () => {
  it('protects home with authGuard', () => {
    const homeRoute = routes.find((route) => route.path === '');

    expect(homeRoute?.canActivate).toEqual([authGuard]);
  });

  it('protects the authenticated pages', () => {
    const protectedPaths = ['gallery', 'album', 'album/:albumId', 'trash'];

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
