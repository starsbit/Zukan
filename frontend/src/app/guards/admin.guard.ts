import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserStore } from '../services/user.store';
import { AuthStore } from '../services/web/auth.store';

export const adminGuard: CanActivateFn = (_route, state) => {
  const authStore = inject(AuthStore);
  const userStore = inject(UserStore);
  const router = inject(Router);

  if (!authStore.isAuthenticated()) {
    return router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`);
  }

  if (userStore.isAdmin()) {
    return true;
  }

  return router.parseUrl('/');
};
