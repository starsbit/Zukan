import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';
import { UrlSegment, UrlSegmentGroup } from '@angular/router';
import { galleryMatcher, routes } from './app.routes';

describe('routes', () => {
  it('serves the root path and gallery from one authenticated route', () => {
    const galleryRoute = routes.find((route) => route.matcher === galleryMatcher);
    const match = (paths: string[]) =>
      galleryMatcher(
        paths.map((path) => new UrlSegment(path, {})),
        new UrlSegmentGroup([], {}),
        galleryRoute!,
      );

    expect(galleryRoute?.canActivate).toEqual([authGuard]);
    expect(match([])?.consumed).toEqual([]);
    expect(match(['gallery'])?.consumed.map((segment) => segment.path)).toEqual(['gallery']);
    expect(match(['gallery', 'media', 'm1'])?.consumed.map((segment) => segment.path)).toEqual([
      'gallery',
    ]);
    expect(match(['tags'])).toBeNull();
  });

  it('matches a standalone media URL before the gallery route', () => {
    const paths = routes.map((route) => route.path ?? 'matcher');

    expect(paths.indexOf('media/:mediaId')).toBeLessThan(paths.indexOf('matcher'));
  });

  it.each(['album/:albumId', 'favorites', 'trash'])('opens media under %s', (path) => {
    const route = routes.find((candidate) => candidate.path === path);

    expect(route?.children?.map((child) => child.path)).toEqual(['media/:mediaId']);
  });

  it('redirects the retired browse route to gallery', () => {
    const browseRoute = routes.find((route) => route.path === 'browse');

    expect(browseRoute?.redirectTo).toBe('gallery');
    expect(browseRoute?.pathMatch).toBe('full');
  });

  it('protects the authenticated pages', () => {
    const protectedPaths = [
      'media/:mediaId',
      'graph/characters',
      'album',
      'album/:albumId',
      'favorites',
      'tags',
      'trash',
    ];

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

    expect(adminRoute?.canActivate).toEqual([authGuard]);
  });

  it('redirects unknown routes to the root gallery route', () => {
    const wildcardRoute = routes.find((route) => route.path === '**');

    expect(wildcardRoute?.redirectTo).toBe('');
  });
});
