import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { NotificationListResponse, NotificationRead } from '../../models/notifications';

export interface NotificationListParams {
  after?: string;
  page_size?: number;
  is_read?: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationsClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  list(p: NotificationListParams = {}): Observable<NotificationListResponse> {
    let params = new HttpParams();
    if (p.after != null) params = params.set('after', p.after);
    if (p.page_size != null) params = params.set('page_size', p.page_size);
    if (p.is_read != null) params = params.set('is_read', p.is_read);
    return this.http.get<NotificationListResponse>(`${this.base}/api/v1/me/notifications`, {
      params,
    });
  }

  markRead(id: string): Observable<NotificationRead> {
    return this.http.patch<NotificationRead>(
      `${this.base}/api/v1/me/notifications/${id}/read`,
      null,
    );
  }

  markAllRead(): Observable<void> {
    return this.http.post<void>(`${this.base}/api/v1/me/notifications/read-all`, null);
  }

  acceptInvite(id: string): Observable<NotificationRead> {
    return this.http.post<NotificationRead>(
      `${this.base}/api/v1/me/notifications/${id}/accept`,
      null,
    );
  }

  rejectInvite(id: string): Observable<NotificationRead> {
    return this.http.post<NotificationRead>(
      `${this.base}/api/v1/me/notifications/${id}/reject`,
      null,
    );
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/v1/me/notifications/${id}`);
  }
}
