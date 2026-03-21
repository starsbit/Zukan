import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  AdminStatsResponse,
  AdminUserDetail,
  AdminUserUpdateDto,
  ListAdminUsersQuery,
  TaggingJobQueuedResponse,
  UserListResponse,
  UserRead,
  Uuid
} from '../../models/api';
import { ClientApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class AdminClientService {
  private readonly api = inject(ClientApiService);

  getStats(): Observable<AdminStatsResponse> {
    return this.api.get<AdminStatsResponse>('/admin/stats');
  }

  listUsers(query?: ListAdminUsersQuery): Observable<UserListResponse> {
    return this.api.get<UserListResponse>('/admin/users', { query });
  }

  getUserDetail(userId: Uuid): Observable<AdminUserDetail> {
    return this.api.get<AdminUserDetail>(`/admin/users/${userId}`);
  }

  updateUser(userId: Uuid, body: AdminUserUpdateDto): Observable<UserRead> {
    return this.api.patch<UserRead>(`/admin/users/${userId}`, body);
  }

  deleteUser(userId: Uuid, deleteMedia?: boolean): Observable<void> {
    return this.api.deleteVoid(`/admin/users/${userId}`, {
      query: { delete_media: deleteMedia }
    });
  }

  queueUserTaggingJobs(userId: Uuid): Observable<TaggingJobQueuedResponse> {
    return this.api.post<TaggingJobQueuedResponse>(`/admin/users/${userId}/tagging-jobs`, {});
  }
}
