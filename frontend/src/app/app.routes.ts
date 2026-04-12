import { Routes } from '@angular/router';
import { AdminDashboardPageComponent } from './pages/admin-dashboard/admin-dashboard-page.component';
import { adminGuard } from './guards/admin.guard';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';
import { AlbumComponent } from './pages/album/album.component';
import { AlbumDetailComponent } from './pages/album-detail/album-detail.component';
import { FavoritesComponent } from './pages/favorites/favorites.component';
import { GalleryComponent } from './pages/gallery/gallery.component';
import { BrowseComponent } from './pages/browse/browse.component';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { MetadataManagerPageComponent } from './pages/metadata-manager/metadata-manager-page.component';
import { TrashComponent } from './pages/trash/trash.component';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginPageComponent,
    canActivate: [guestGuard],
  },
  {
    path: '',
    component: GalleryComponent,
    canActivate: [authGuard],
  },
  {
    path: 'browse',
    component: BrowseComponent,
    canActivate: [authGuard],
  },
  {
    path: 'admin',
    component: AdminDashboardPageComponent,
    canActivate: [adminGuard],
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
    path: 'tags',
    component: MetadataManagerPageComponent,
    canActivate: [authGuard],
  },
  {
    path: 'trash',
    component: TrashComponent,
    canActivate: [authGuard],
  },
];
