import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { TokenResponse, UserLogin, UserRegister, UserSelfRead } from '../../models/auth';
import { RefreshTokenRequest } from '../../models/auth';

@Injectable({ providedIn: 'root' })
export class AuthClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  register(body: UserRegister): Observable<UserSelfRead> {
    return this.http.post<UserSelfRead>(`${this.base}/api/v1/auth/register`, body);
  }

  login(body: UserLogin): Observable<TokenResponse> {
    const form = new HttpParams()
      .set('username', body.username)
      .set('password', body.password)
      .set('remember_me', String(body.remember_me ?? false));
    return this.http.post<TokenResponse>(`${this.base}/api/v1/auth/login`, form.toString(), {
      headers: new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    });
  }

  refresh(body: RefreshTokenRequest): Observable<TokenResponse> {
    return this.http.post<TokenResponse>(`${this.base}/api/v1/auth/refresh`, body);
  }

  logout(body: RefreshTokenRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/api/v1/auth/logout`, body);
  }
}
