import { Routes, UrlMatcher } from '@angular/router';
import { AdminDashboardPageComponent } from './pages/admin-dashboard/admin-dashboard-page.component';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';
import { AlbumComponent } from './pages/album/album.component';
import { AlbumDetailComponent } from './pages/album-detail/album-detail.component';
import { FavoritesComponent } from './pages/favorites/favorites.component';
import { GalleryComponent } from './pages/gallery/gallery.component';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { MetadataManagerPageComponent } from './pages/metadata-manager/metadata-manager-page.component';
import { TrashComponent } from './pages/trash/trash.component';

const loadMediaInspectorPage = () =>
  import('./pages/media-inspector/media-inspector-page.component').then(
    (m) => m.MediaInspectorPageComponent,
  );

const mediaDetailChildren: Routes = [
  {
    path: 'media/:mediaId',
    loadComponent: loadMediaInspectorPage,
  },
];

export const galleryMatcher: UrlMatcher = (segments) => {
  if (segments.length === 0) {
    return { consumed: [] };
  }
  return segments[0]?.path === 'gallery' ? { consumed: segments.slice(0, 1) } : null;
};

export const routes: Routes = [
  {
    path: 'login',
    component: LoginPageComponent,
    canActivate: [guestGuard],
  },
  {
    path: 'browse',
    redirectTo: 'gallery',
    pathMatch: 'full',
  },
  {
    path: 'media/:mediaId',
    loadComponent: loadMediaInspectorPage,
    canActivate: [authGuard],
  },
  {
    matcher: galleryMatcher,
    component: GalleryComponent,
    canActivate: [authGuard],
    children: mediaDetailChildren,
  },
  {
    path: 'graph/characters',
    loadComponent: () =>
      import('./pages/character-graph/character-graph.component').then(
        (m) => m.CharacterGraphPageComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: 'admin',
    component: AdminDashboardPageComponent,
    canActivate: [authGuard],
  },
  {
    path: 'album/:albumId',
    component: AlbumDetailComponent,
    canActivate: [authGuard],
    children: mediaDetailChildren,
  },
  {
    path: 'album',
    component: AlbumComponent,
    canActivate: [authGuard],
  },
  {
    path: 'favorites',
    component: FavoritesComponent,
    canActivate: [authGuard],
    children: mediaDetailChildren,
  },

  {
    path: 'tags',
    component: MetadataManagerPageComponent,
    canActivate: [authGuard],
  },
  {
    path: 'trash',
    component: TrashComponent,
    canActivate: [authGuard],
    children: mediaDetailChildren,
  },
  {
    path: '**',
    redirectTo: '',
  },
];
