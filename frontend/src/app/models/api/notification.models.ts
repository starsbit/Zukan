import type { Uuid } from './common.models';

export type NotificationType = 'batch_done' | 'batch_failed' | 'app_update' | 'share_invite';
export type AnnouncementSeverity = 'info' | 'warning' | 'critical';

export interface NotificationRead {
  id: Uuid;
  user_id: Uuid;
  type: NotificationType;
  title: string;
  body: string;
  is_read: boolean;
  link_url: string | null;
  created_at: string;
}

export interface NotificationListResponse {
  total: number;
  next_cursor: string | null;
  has_more: boolean;
  page_size: number;
  items: NotificationRead[];
}

export interface ListNotificationsQuery {
  after?: string | null;
  page_size?: number;
  is_read?: boolean | null;
}

export interface AppAnnouncementCreateDto {
  version?: string | null;
  title: string;
  message: string;
  severity?: AnnouncementSeverity;
  starts_at?: string | null;
  ends_at?: string | null;
}

export interface AppAnnouncementRead {
  id: Uuid;
  version: string | null;
  title: string;
  message: string;
  severity: AnnouncementSeverity;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
}
