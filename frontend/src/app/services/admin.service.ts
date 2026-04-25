import { inject, Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { AdminClientService, AdminUserListParams } from './web/admin-client.service';
import { UserStore } from './user.store';
import { UserRead } from '../models/auth';
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
} from '../models/admin';
import { AppAnnouncementCreate, AppAnnouncementRead } from '../models/notifications';
import { TaggingJobQueuedResponse } from '../models/uploads';

const FORBIDDEN = new Error('Forbidden: admin access required');

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly client = inject(AdminClientService);
  private readonly userStore = inject(UserStore);

  private guard<T>(op: () => Observable<T>): Observable<T> {
    return this.userStore.isAdmin() ? op() : throwError(() => FORBIDDEN);
  }

  getStats(): Observable<AdminStatsResponse> {
    return this.guard(() => this.client.getStats());
  }

  getHealth(): Observable<AdminHealthResponse> {
    return this.guard(() => this.client.getHealth());
  }

  listUsers(p?: AdminUserListParams): Observable<UserListResponse> {
    return this.guard(() => this.client.listUsers(p));
  }

  getUser(userId: string): Observable<AdminUserDetail> {
    return this.guard(() => this.client.getUser(userId));
  }

  updateUser(userId: string, body: AdminUserUpdate): Observable<UserRead> {
    return this.guard(() => this.client.updateUser(userId, body));
  }

  deleteUserMedia(userId: string): Observable<DeleteUserMediaResponse> {
    return this.guard(() => this.client.deleteUserMedia(userId));
  }

  deleteUser(userId: string, deleteMedia = false): Observable<void> {
    return this.guard(() => this.client.deleteUser(userId, deleteMedia));
  }

  retagAll(userId: string): Observable<TaggingJobQueuedResponse> {
    return this.guard(() => this.client.retagAll(userId));
  }

  startEmbeddingBackfill(userId: string): Observable<AdminEmbeddingBackfillResponse> {
    return this.guard(() => this.client.startEmbeddingBackfill(userId));
  }

  getEmbeddingBackfillStatus(batchId: string): Observable<AdminEmbeddingBackfillStatus> {
    return this.guard(() => this.client.getEmbeddingBackfillStatus(batchId));
  }

  getEmbeddingClusters(
    userId: string,
    mode: EmbeddingClusterMode,
    options?: { limit?: number; sample_size?: number; min_cluster_size?: number; discovery_mode?: boolean },
  ): Observable<AdminEmbeddingClusterListResponse> {
    return this.guard(() => this.client.getEmbeddingClusters(userId, mode, options));
  }

  getEmbeddingClusterPlot(
    userId: string,
    mode: EmbeddingClusterMode,
    options?: { min_cluster_size?: number; discovery_mode?: boolean },
  ): Observable<Blob> {
    return this.guard(() => this.client.getEmbeddingClusterPlot(userId, mode, options));
  }

  getLibraryClassificationMetrics(
    userId: string,
    modelVersion?: string,
  ): Observable<AdminLibraryClassificationMetricsResponse> {
    return this.guard(() => this.client.getLibraryClassificationMetrics(userId, modelVersion));
  }

  listAnnouncements(): Observable<AppAnnouncementRead[]> {
    return this.guard(() => this.client.listAnnouncements());
  }

  createAnnouncement(body: AppAnnouncementCreate): Observable<AppAnnouncementRead> {
    return this.guard(() => this.client.createAnnouncement(body));
  }

  checkForUpdates(): Observable<UpdateCheckResponse> {
    return this.guard(() => this.client.checkForUpdates());
  }
}
