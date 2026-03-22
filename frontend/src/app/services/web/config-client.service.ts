import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { UploadConfig } from '../../models/api';
import { ClientApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class ConfigClientService {
  private readonly api = inject(ClientApiService);

  getUploadConfig(): Observable<UploadConfig> {
    return this.api.get<UploadConfig>('/config/upload');
  }
}
