import { CursorPage } from './common';

export enum NotificationType {
  BATCH_DONE = 'batch_done',
  BATCH_FAILED = 'batch_failed',
  APP_UPDATE = 'app_update',
  SHARE_INVITE = 'share_invite',
  METADATA_REVIEW = 'metadata_review',
  WELCOME = 'welcome',
}

export enum AnnouncementSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export interface ShareInviteNotificationData {
  album_id: string;
  album_name: string;
  role: 'viewer' | 'editor';
  invited_by_user_id: string;
  invited_by_username: string;
  invite_status: 'pending' | 'accepted' | 'rejected';
  invite_id: string;
}

export interface AppUpdateNotificationData {
  announcement_id: string;
  severity: AnnouncementSeverity;
  version: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

export interface MetadataReviewNotificationData {
  latest_batch_id: string;
  review_batch_ids: string[];
  unresolved_count: number;
  dismiss_signature: string;
}

export type NotificationData =
  | ShareInviteNotificationData
  | AppUpdateNotificationData
  | MetadataReviewNotificationData
  | Record<string, unknown>;

export interface NotificationRead {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  is_read: boolean;
  link_url: string | null;
  data: NotificationData | null;
  created_at: string;
}

export interface AppAnnouncementRead {
  id: string;
  version: string | null;
  title: string;
  message: string;
  severity: AnnouncementSeverity;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AppAnnouncementCreate {
  version?: string | null;
  title: string;
  message: string;
  severity?: AnnouncementSeverity;
  starts_at?: string | null;
  ends_at?: string | null;
}

export type NotificationListResponse = CursorPage<NotificationRead>;
