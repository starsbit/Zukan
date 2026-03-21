import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';

import {
  AccessTokenResponse,
  LogoutRequestDto,
  RefreshRequestDto,
  TokenResponse,
  UserLoginDto,
  UserRead,
  UserRegisterDto
} from '../../models/api';
import { ClientApiService } from './api.service';
import { ClientAuthStore } from './auth.store';

@Injectable({
  providedIn: 'root'
})
export class AuthClientService {
  private readonly api = inject(ClientApiService);
  private readonly authStore = inject(ClientAuthStore);

  register(body: UserRegisterDto): Observable<UserRead> {
    return this.api.post<UserRead>('/auth/register', body, { auth: 'none' });
  }

  login(body: UserLoginDto): Observable<TokenResponse> {
    return this.api.post<TokenResponse>('/auth/login', body, { auth: 'none' }).pipe(
      tap((response) => this.authStore.setTokens({
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        tokenType: response.token_type
      }))
    );
  }

  refresh(body?: RefreshRequestDto): Observable<AccessTokenResponse> {
    const refreshToken = body?.refresh_token ?? this.authStore.getRefreshToken() ?? '';

    return this.api.post<AccessTokenResponse>('/auth/refresh', { refresh_token: refreshToken }, { auth: 'none' }).pipe(
      tap((response) => this.authStore.setTokens({
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        tokenType: response.token_type
      }))
    );
  }

  logout(body?: LogoutRequestDto): Observable<void> {
    const refreshToken = body?.refresh_token ?? this.authStore.getRefreshToken() ?? '';

    return this.api.post<void>('/auth/logout', { refresh_token: refreshToken }, { auth: 'none' }).pipe(
      tap(() => this.authStore.clearTokens())
    );
  }
}
