import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '../services/web/auth.store';

export const authGuard: CanActivateFn = (_route, state) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);
  if (authStore.isAuthenticated()) return true;
  return router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`);
};
