import { Routes } from '@angular/router';

import { authGuard } from './guard/auth.guard';
import { guestGuard } from './guard/guest.guard';
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
