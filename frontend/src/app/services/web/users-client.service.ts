import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { AniListIntegrationRead, ApiKeyCreateResponse, ApiKeyStatusResponse, UserRead, UserUpdate } from '../../models/auth';

@Injectable({ providedIn: 'root' })
export class UsersClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  getMe(): Observable<UserRead> {
    return this.http.get<UserRead>(`${this.base}/api/v1/me`);
  }

  updateMe(body: UserUpdate): Observable<UserRead> {
    return this.http.patch<UserRead>(`${this.base}/api/v1/me`, body);
  }

  getApiKeyStatus(): Observable<ApiKeyStatusResponse> {
    return this.http.get<ApiKeyStatusResponse>(`${this.base}/api/v1/me/api-key`);
  }

  createApiKey(): Observable<ApiKeyCreateResponse> {
    return this.http.post<ApiKeyCreateResponse>(`${this.base}/api/v1/me/api-key`, {});
  }

  getAniListIntegration(): Observable<AniListIntegrationRead> {
    return this.http.get<AniListIntegrationRead>(`${this.base}/api/v1/me/integrations/anilist`);
  }

  upsertAniListIntegration(token: string): Observable<AniListIntegrationRead> {
    return this.http.put<AniListIntegrationRead>(`${this.base}/api/v1/me/integrations/anilist`, { token });
  }

  deleteAniListIntegration(): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/v1/me/integrations/anilist`);
  }
}
