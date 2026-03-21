import type { Uuid } from './common.models';

export interface UserRead {
  id: Uuid;
  username: string;
  email: string;
  is_admin: boolean;
  show_nsfw: boolean;
  created_at: string;
}

export interface UserUpdateDto {
  show_nsfw?: boolean | null;
  password?: string | null;
}

export interface AdminUserUpdateDto {
  is_admin?: boolean | null;
  show_nsfw?: boolean | null;
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

export interface UserListResponse {
  total: number;
  page: number;
  page_size: number;
  items: UserRead[];
}

export interface ListAdminUsersQuery {
  page?: number;
  page_size?: number;
}
