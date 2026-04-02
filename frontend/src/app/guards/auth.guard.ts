import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthStore } from '../services/web/auth.store';
import { ConfigClientService } from '../services/web/config-client.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);
  if (authStore.isAuthenticated()) return true;
  if (state.url === '/') {
    return inject(ConfigClientService).getSetupRequired().pipe(
      map(({ setup_required }) =>
        setup_required ? true : router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`),
      ),
      catchError(() => of(router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`))),
    );
  }
  return router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`);
};
