import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { SetupRequiredResponse, UploadConfigResponse } from '../../models/uploads';

@Injectable({ providedIn: 'root' })
export class ConfigClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  getUploadConfig(): Observable<UploadConfigResponse> {
    return this.http.get<UploadConfigResponse>(`${this.base}/api/v1/config/upload`);
  }

  getSetupRequired(): Observable<SetupRequiredResponse> {
    return this.http.get<SetupRequiredResponse>(`${this.base}/api/v1/config/setup-required`);
  }
}
