import { UserRead } from './auth';
import { PagedList } from './common';

export interface AdminUserUpdate {
  username?: string | null;
  is_admin?: boolean | null;
  show_nsfw?: boolean | null;
  show_sensitive?: boolean | null;
  tag_confidence_threshold?: number | null;
  password?: string | null;
}

export interface AdminUserSummary extends UserRead {
  media_count: number;
  storage_used_bytes: number;
}

export interface AdminUserDetail extends AdminUserSummary {}

export interface AdminStorageUserSummary {
  user_id: string;
  username: string;
  media_count: number;
  storage_used_bytes: number;
}

export interface AdminStatsResponse {
  total_users: number;
  total_media: number;
  total_storage_bytes: number;
  pending_tagging: number;
  failed_tagging: number;
  trashed_media: number;
  storage_by_user: AdminStorageUserSummary[];
}

export interface AdminHealthSample {
  captured_at: string;
  cpu_percent: number;
  memory_rss_bytes: number;
}

export interface AdminHealthResponse {
  generated_at: string;
  uptime_seconds: number;
  cpu_percent: number;
  memory_rss_bytes: number;
  system_memory_total_bytes: number | null;
  system_memory_used_bytes: number | null;
  tagging_queue_depth: number;
  samples: AdminHealthSample[];
}

export interface DeleteUserMediaResponse {
  deleted: number;
}

export type UserListResponse = PagedList<AdminUserSummary>;
