import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  ListNotificationsQuery,
  NotificationListResponse,
  NotificationRead,
  Uuid
} from '../../models/api';
import { ClientApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class NotificationsClientService {
  private readonly api = inject(ClientApiService);

  list(query?: ListNotificationsQuery): Observable<NotificationListResponse> {
    return this.api.get<NotificationListResponse>('/me/notifications', { query });
  }

  markRead(notificationId: Uuid): Observable<NotificationRead> {
    return this.api.patch<NotificationRead>(`/me/notifications/${notificationId}/read`, {});
  }

  markAllRead(): Observable<void> {
    return this.api.post<void>('/me/notifications/read-all', null);
  }

  delete(notificationId: Uuid): Observable<void> {
    return this.api.delete<void>(`/me/notifications/${notificationId}`);
  }
}
