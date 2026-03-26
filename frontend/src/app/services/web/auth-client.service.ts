import { Injectable, inject } from '@angular/core';
import { HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  AccessTokenResponse,
  LogoutRequestDto,
  RefreshRequestDto,
  TokenResponse,
  UserLoginDto,
  UserSelfReadLite,
  UserRegisterDto
} from '../../models/api';
import { ClientApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class AuthClientService {
  private readonly api = inject(ClientApiService);

  register(body: UserRegisterDto): Observable<UserSelfReadLite> {
    return this.api.post<UserSelfReadLite>('/auth/register', body, { auth: 'none' });
  }

  login(body: UserLoginDto): Observable<TokenResponse> {
    let form = new HttpParams()
      .set('username', body.username)
      .set('password', body.password);

    if (body.remember_me !== undefined) {
      form = form.set('remember_me', String(body.remember_me));
    }

    return this.api.post<TokenResponse>('/auth/login', form.toString(), {
      auth: 'none',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
  }

  refresh(body: RefreshRequestDto): Observable<AccessTokenResponse> {
    return this.api.post<AccessTokenResponse>('/auth/refresh', body, { auth: 'none' });
  }

  logout(body: LogoutRequestDto): Observable<void> {
    return this.api.post<void>('/auth/logout', body, { auth: 'none' });
  }
}
