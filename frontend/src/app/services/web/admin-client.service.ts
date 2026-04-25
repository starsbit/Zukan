import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { UserRead } from '../../models/auth';
import {
  AdminEmbeddingBackfillResponse,
  AdminEmbeddingBackfillStatus,
  AdminEmbeddingClusterListResponse,
  EmbeddingClusterMode,
  AdminHealthResponse,
  AdminLibraryClassificationMetricsResponse,
  AdminStatsResponse,
  AdminUserDetail,
  AdminUserUpdate,
  DeleteUserMediaResponse,
  UpdateCheckResponse,
  UserListResponse,
} from '../../models/admin';
import { AppAnnouncementCreate, AppAnnouncementRead } from '../../models/notifications';
import { TaggingJobQueuedResponse } from '../../models/uploads';

export interface AdminUserListParams {
  page?: number;
  page_size?: number;
  sort_by?: 'username' | 'created_at';
  sort_order?: 'asc' | 'desc';
}

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

  listUsers(p: AdminUserListParams = {}): Observable<UserListResponse> {
    let params = new HttpParams();
    if (p.page != null) params = params.set('page', p.page);
    if (p.page_size != null) params = params.set('page_size', p.page_size);
    if (p.sort_by != null) params = params.set('sort_by', p.sort_by);
    if (p.sort_order != null) params = params.set('sort_order', p.sort_order);
    return this.http.get<UserListResponse>(`${this.base}/api/v1/admin/users`, { params });
  }

  getUser(userId: string): Observable<AdminUserDetail> {
    return this.http.get<AdminUserDetail>(`${this.base}/api/v1/admin/users/${userId}`);
  }

  updateUser(userId: string, body: AdminUserUpdate): Observable<UserRead> {
    return this.http.patch<UserRead>(`${this.base}/api/v1/admin/users/${userId}`, body);
  }

  deleteUserMedia(userId: string): Observable<DeleteUserMediaResponse> {
    return this.http.delete<DeleteUserMediaResponse>(`${this.base}/api/v1/admin/users/${userId}/media`);
  }

  deleteUser(userId: string, deleteMedia = false): Observable<void> {
    const params = new HttpParams().set('delete_media', deleteMedia);
    return this.http.delete<void>(`${this.base}/api/v1/admin/users/${userId}`, { params });
  }

  retagAll(userId: string): Observable<TaggingJobQueuedResponse> {
    return this.http.post<TaggingJobQueuedResponse>(
      `${this.base}/api/v1/admin/users/${userId}/tagging-jobs`,
      null,
    );
  }

  startEmbeddingBackfill(userId: string): Observable<AdminEmbeddingBackfillResponse> {
    return this.http.post<AdminEmbeddingBackfillResponse>(
      `${this.base}/api/v1/admin/users/${userId}/embedding-backfill`,
      null,
    );
  }

  getEmbeddingBackfillStatus(batchId: string): Observable<AdminEmbeddingBackfillStatus> {
    return this.http.get<AdminEmbeddingBackfillStatus>(
      `${this.base}/api/v1/admin/embedding-backfills/${batchId}`,
    );
  }

  getEmbeddingClusters(
    userId: string,
    mode: EmbeddingClusterMode,
    options: { limit?: number; sample_size?: number; min_cluster_size?: number } = {},
  ): Observable<AdminEmbeddingClusterListResponse> {
    let params = new HttpParams().set('mode', mode);
    if (options.limit != null) params = params.set('limit', options.limit);
    if (options.sample_size != null) params = params.set('sample_size', options.sample_size);
    if (options.min_cluster_size != null) params = params.set('min_cluster_size', options.min_cluster_size);
    return this.http.get<AdminEmbeddingClusterListResponse>(
      `${this.base}/api/v1/admin/users/${userId}/embedding-clusters`,
      { params },
    );
  }

  getEmbeddingClusterPlot(
    userId: string,
    mode: EmbeddingClusterMode,
    options: { min_cluster_size?: number } = {},
  ): Observable<Blob> {
    let params = new HttpParams().set('mode', mode);
    if (options.min_cluster_size != null) params = params.set('min_cluster_size', options.min_cluster_size);
    return this.http.get(
      `${this.base}/api/v1/admin/users/${userId}/embedding-clusters/plot`,
      { params, responseType: 'blob' },
    );
  }

  getLibraryClassificationMetrics(
    userId: string,
    modelVersion?: string,
  ): Observable<AdminLibraryClassificationMetricsResponse> {
    let params = new HttpParams();
    if (modelVersion) params = params.set('model_version', modelVersion);
    return this.http.get<AdminLibraryClassificationMetricsResponse>(
      `${this.base}/api/v1/admin/users/${userId}/library-classification-metrics`,
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
