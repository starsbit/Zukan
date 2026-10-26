import { inject, Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { AdminClientService } from './web/admin-client.service';
import { UserStore } from './user.store';
import { UserRead } from '../models/auth';
import {
  AdminEmbeddingBackfillResponse,
  AdminEmbeddingBackfillStatus,
  AdminHealthResponse,
  AdminLibraryClassificationMetricsResponse,
  AdminStatsResponse,
} from '../models/admin';
import { AppAnnouncementCreate, AppAnnouncementRead } from '../models/notifications';
import { TaggingJobQueuedResponse } from '../models/uploads';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly client = inject(AdminClientService);
  private readonly userStore = inject(UserStore);

  private guard<T>(op: () => Observable<T>): Observable<T> {
    return op();
  }

  getStats(): Observable<AdminStatsResponse> {
    return this.guard(() => this.client.getStats());
  }

  getHealth(): Observable<AdminHealthResponse> {
    return this.guard(() => this.client.getHealth());
  }

  retagAll(): Observable<TaggingJobQueuedResponse> {
    return this.guard(() => this.client.retagAll());
  }

  startEmbeddingBackfill(): Observable<AdminEmbeddingBackfillResponse> {
    return this.guard(() => this.client.startEmbeddingBackfill());
  }

  getEmbeddingBackfillStatus(batchId: string): Observable<AdminEmbeddingBackfillStatus> {
    return this.guard(() => this.client.getEmbeddingBackfillStatus(batchId));
  }

  getLibraryClassificationMetrics(
    modelVersion?: string,
  ): Observable<AdminLibraryClassificationMetricsResponse> {
    return this.guard(() => this.client.getLibraryClassificationMetrics(modelVersion));
  }

  listAnnouncements(): Observable<AppAnnouncementRead[]> {
    return this.guard(() => this.client.listAnnouncements());
  }

  createAnnouncement(body: AppAnnouncementCreate): Observable<AppAnnouncementRead> {
    return this.guard(() => this.client.createAnnouncement(body));
  }

}
