import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { UserRead } from '../../models/auth';
import {
  AdminEmbeddingBackfillResponse,
  AdminEmbeddingBackfillStatus,
  AdminHealthResponse,
  AdminLibraryClassificationMetricsResponse,
  AdminStatsResponse,
  UpdateCheckResponse,
} from '../../models/admin';
import { AppAnnouncementCreate, AppAnnouncementRead } from '../../models/notifications';
import { TaggingJobQueuedResponse } from '../../models/uploads';

@Injectable({ providedIn: 'root' })
export class AdminClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  getStats(): Observable<AdminStatsResponse> {
    return this.http.get<AdminStatsResponse>(`${this.base}/api/v1/admin/stats`);
  }

  getHealth(): Observable<AdminHealthResponse> {
    return this.http.get<AdminHealthResponse>(`${this.base}/api/v1/admin/health`);
  }

  retagAll(): Observable<TaggingJobQueuedResponse> {
    return this.http.post<TaggingJobQueuedResponse>(`${this.base}/api/v1/admin/tagging-jobs`, null);
  }

  startEmbeddingBackfill(): Observable<AdminEmbeddingBackfillResponse> {
    return this.http.post<AdminEmbeddingBackfillResponse>(
      `${this.base}/api/v1/admin/embedding-backfill`,
      null,
    );
  }

  getEmbeddingBackfillStatus(batchId: string): Observable<AdminEmbeddingBackfillStatus> {
    return this.http.get<AdminEmbeddingBackfillStatus>(
      `${this.base}/api/v1/admin/embedding-backfills/${batchId}`,
    );
  }

  getLibraryClassificationMetrics(
    modelVersion?: string,
  ): Observable<AdminLibraryClassificationMetricsResponse> {
    let params = new HttpParams();
    if (modelVersion) params = params.set('model_version', modelVersion);
    return this.http.get<AdminLibraryClassificationMetricsResponse>(
      `${this.base}/api/v1/admin/library-classification-metrics`,
      { params },
    );
  }

  listAnnouncements(): Observable<AppAnnouncementRead[]> {
    return this.http.get<AppAnnouncementRead[]>(`${this.base}/api/v1/admin/announcements`);
  }

  createAnnouncement(body: AppAnnouncementCreate): Observable<AppAnnouncementRead> {
    return this.http.post<AppAnnouncementRead>(`${this.base}/api/v1/admin/announcements`, body);
  }

  checkForUpdates(): Observable<UpdateCheckResponse> {
    return this.http.post<UpdateCheckResponse>(`${this.base}/api/v1/admin/check-updates`, null);
  }

  triggerUpdate(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/api/v1/admin/update`, null);
  }
}
