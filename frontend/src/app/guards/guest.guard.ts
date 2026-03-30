import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '../services/web/auth.store';

export const guestGuard: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);
  if (!authStore.isAuthenticated()) return true;
  return router.parseUrl('/');
};
