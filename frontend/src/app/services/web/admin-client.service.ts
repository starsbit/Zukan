import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { UserRead } from '../../models/auth';
import {
  AdminStatsResponse,
  AdminUserDetail,
  AdminUserUpdate,
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

  listAnnouncements(): Observable<AppAnnouncementRead[]> {
    return this.http.get<AppAnnouncementRead[]>(`${this.base}/api/v1/admin/announcements`);
  }

  createAnnouncement(body: AppAnnouncementCreate): Observable<AppAnnouncementRead> {
    return this.http.post<AppAnnouncementRead>(`${this.base}/api/v1/admin/announcements`, body);
  }
}
