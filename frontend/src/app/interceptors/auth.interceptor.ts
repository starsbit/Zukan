import { HttpErrorResponse, HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpEvent } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, throwError, EMPTY } from 'rxjs';
import { catchError, filter, switchMap, take } from 'rxjs/operators';
import { AuthStore } from '../services/web/auth.store';
import { AuthClientService } from '../services/web/auth-client.service';

const AUTH_PATH = '/api/v1/auth/';

function withBearer<T>(req: HttpRequest<T>, token: string): HttpRequest<T> {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

function handleTokenRefresh(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  authStore: AuthStore,
  authClient: AuthClientService,
  router: Router,
): Observable<HttpEvent<unknown>> {
  if (authStore.isRefreshing) {
    return authStore.refreshResult$.pipe(
      filter((token): token is string => token !== null),
      take(1),
      switchMap(token => next(withBearer(req, token))),
    );
  }

  const refreshToken = authStore.getRefreshToken();
  if (!refreshToken) {
    authStore.clear();
    router.navigate(['/login']);
    return EMPTY;
  }

  authStore.isRefreshing = true;
  authStore.refreshResult$.next(null);

  return authClient.refresh({ refresh_token: refreshToken }).pipe(
    switchMap(tokens => {
      authStore.isRefreshing = false;
      authStore.setTokens(tokens, authStore.isPersisted());
      authStore.refreshResult$.next(tokens.access_token);
      return next(withBearer(req, tokens.access_token));
    }),
    catchError(err => {
      authStore.isRefreshing = false;
      authStore.clear();
      router.navigate(['/login']);
      return throwError(() => err);
    }),
  );
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.includes(AUTH_PATH)) {
    return next(req);
  }

  const authStore = inject(AuthStore);
  const authClient = inject(AuthClientService);
  const router = inject(Router);

  const token = authStore.getAccessToken();
  const outgoing = token ? withBearer(req, token) : req;

  return next(outgoing).pipe(
    catchError(err => {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        return handleTokenRefresh(req, next, authStore, authClient, router);
      }
      return throwError(() => err);
    }),
  );
};
