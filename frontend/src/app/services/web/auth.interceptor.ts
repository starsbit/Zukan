import { HttpClient, HttpContext, HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, finalize, map, Observable, shareReplay, switchMap, throwError } from 'rxjs';

import { CLIENT_API_BASE_URL } from './api.config';
import { AccessTokenResponse } from './api-models';
import { ClientAuthStore } from './auth.store';

export type ClientAuthMode = 'required' | 'optional' | 'none';

export const AUTH_MODE = new HttpContextToken<ClientAuthMode>(() => 'required');
export const AUTH_REFRESH_ATTEMPTED = new HttpContextToken<boolean>(() => false);

let refreshTokenRequest$: Observable<string> | null = null;

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const http = inject(HttpClient);
  const baseUrl = inject(CLIENT_API_BASE_URL);
  const authStore = inject(ClientAuthStore);
  const authMode = request.context.get(AUTH_MODE);
  const refreshAttempted = request.context.get(AUTH_REFRESH_ATTEMPTED);

  if (authMode === 'none' || request.headers.has('Authorization')) {
    return next(request);
  }

  const accessToken = authStore.getAccessToken();

  if (!accessToken) {
    return next(request);
  }

  const authenticatedRequest = request.clone({
    setHeaders: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return next(authenticatedRequest).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || refreshAttempted) {
        return throwError(() => error);
      }

      const refreshToken = authStore.getRefreshToken();
      if (!refreshToken) {
        authStore.clearTokens();
        return throwError(() => error);
      }

      return refreshAccessToken(http, baseUrl, authStore).pipe(
        switchMap((nextAccessToken) => next(authenticatedRequest.clone({
          context: authenticatedRequest.context.set(AUTH_REFRESH_ATTEMPTED, true),
          setHeaders: {
            Authorization: `Bearer ${nextAccessToken}`
          }
        }))),
        catchError((refreshError) => {
          authStore.clearTokens();
          return throwError(() => refreshError);
        })
      );
    })
  );
};

function refreshAccessToken(
  http: HttpClient,
  baseUrl: string,
  authStore: ClientAuthStore
): Observable<string> {
  if (!refreshTokenRequest$) {
    const refreshToken = authStore.getRefreshToken();

    if (!refreshToken) {
      authStore.clearTokens();
      return throwError(() => new Error('No refresh token available'));
    }

    refreshTokenRequest$ = http.post<AccessTokenResponse>(
      buildUrl(baseUrl, '/auth/refresh'),
      { refresh_token: refreshToken },
      {
        context: requestContextWithoutAuth()
      }
    ).pipe(
      map((response) => {
        authStore.setTokens({
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          tokenType: response.token_type
        });

        return response.access_token;
      }),
      finalize(() => {
        refreshTokenRequest$ = null;
      }),
      shareReplay(1)
    );
  }

  return refreshTokenRequest$;
}

function requestContextWithoutAuth() {
  return new HttpContext()
    .set(AUTH_MODE, 'none')
    .set(AUTH_REFRESH_ATTEMPTED, true);
}

function buildUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
