import { inject, Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { AdminClientService, AdminUserListParams } from './web/admin-client.service';
import { UserStore } from './user.store';
import { UserRead } from '../models/auth';
import { AdminStatsResponse, AdminUserDetail, AdminUserUpdate, UserListResponse } from '../models/admin';
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

  listUsers(p?: AdminUserListParams): Observable<UserListResponse> {
    return this.guard(() => this.client.listUsers(p));
  }

  getUser(userId: string): Observable<AdminUserDetail> {
    return this.guard(() => this.client.getUser(userId));
  }

  updateUser(userId: string, body: AdminUserUpdate): Observable<UserRead> {
    return this.guard(() => this.client.updateUser(userId, body));
  }

  deleteUser(userId: string, deleteMedia = false): Observable<void> {
    return this.guard(() => this.client.deleteUser(userId, deleteMedia));
  }

  retagAll(userId: string): Observable<TaggingJobQueuedResponse> {
    return this.guard(() => this.client.retagAll(userId));
  }

  listAnnouncements(): Observable<AppAnnouncementRead[]> {
    return this.guard(() => this.client.listAnnouncements());
  }

  createAnnouncement(body: AppAnnouncementCreate): Observable<AppAnnouncementRead> {
    return this.guard(() => this.client.createAnnouncement(body));
  }
}
