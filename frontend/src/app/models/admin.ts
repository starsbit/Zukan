import { UserRead } from './auth';
import { PagedList } from './common';

export interface AdminUserUpdate {
  is_admin?: boolean | null;
  show_nsfw?: boolean | null;
  tag_confidence_threshold?: number | null;
}

export interface AdminUserDetail extends UserRead {
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
}

export type UserListResponse = PagedList<UserRead>;
