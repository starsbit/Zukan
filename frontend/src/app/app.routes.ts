import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';
import { AlbumComponent } from './pages/album/album.component';
import { AlbumDetailComponent } from './pages/album-detail/album-detail.component';
import { FavoritesComponent } from './pages/favorites/favorites.component';
import { GalleryComponent } from './pages/gallery/gallery.component';
import { HomeComponent } from './pages/home/home.component';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { TrashComponent } from './pages/trash/trash.component';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginPageComponent,
    canActivate: [guestGuard],
  },
  {
    path: '',
    component: HomeComponent,
    canActivate: [authGuard],
  },
  {
    path: 'gallery',
    component: GalleryComponent,
    canActivate: [authGuard],
  },
  {
    path: 'album/:albumId',
    component: AlbumDetailComponent,
    canActivate: [authGuard],
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
  },
  {
    path: 'trash',
    component: TrashComponent,
    canActivate: [authGuard],
  },
];
