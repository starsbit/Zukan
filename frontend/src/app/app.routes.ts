import { Routes } from '@angular/router';

import { authGuard } from './guard/auth.guard';
import { guestGuard } from './guard/guest.guard';
import { AlbumDetailPageComponent } from './pages/album-detail-page/album-detail-page.component';
import { AlbumsPageComponent } from './pages/albums-page/albums-page.component';
import { GalleryPageComponent } from './pages/gallery-page/gallery-page.component';
import { LoginPageComponent } from './pages/login-page/login-page.component';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'login'
  },
  {
    path: 'login',
    component: LoginPageComponent,
    canActivate: [guestGuard]
  },
  {
    path: 'albums',
    component: AlbumsPageComponent,
    canActivate: [authGuard]
  },
  {
    path: 'albums/:albumId',
    component: AlbumDetailPageComponent,
    canActivate: [authGuard]
  },
  {
    path: 'gallery',
    component: GalleryPageComponent,
    canActivate: [authGuard],
    data: { state: 'active' }
  },
  {
    path: 'gallery/trash',
    component: GalleryPageComponent,
    canActivate: [authGuard],
    data: { state: 'trashed' }
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
