import type { BulkResult, Uuid } from './common.models';
import type { MediaCursorPage, TagFilterMode } from './media.models';

export interface AlbumCreateDto {
  name: string;
  description?: string | null;
}

export interface AlbumUpdateDto {
  name?: string | null;
  description?: string | null;
  cover_media_id?: Uuid | null;
  version?: number | null;
}

export interface AlbumRead {
  id: Uuid;
  owner_id: Uuid;
  name: string;
  description: string | null;
  cover_media_id: Uuid | null;
  media_count?: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AlbumListResponse {
  total: number;
  next_cursor: string | null;
  prev_cursor: string | null;
  has_more: boolean;
  page_size: number;
  items: AlbumRead[];
}

export type AlbumShareRole = 'viewer' | 'editor';
export type AlbumShareReadRole = AlbumShareRole | 'owner';

export interface AlbumShareCreateDto {
  user_id: Uuid;
  role?: AlbumShareRole;
}

export interface AlbumShareRead {
  user_id: Uuid;
  role: AlbumShareReadRole;
  shared_at: string;
  shared_by_user_id?: Uuid | null;
}

export interface AlbumOwnershipTransferDto {
  new_owner_user_id: Uuid;
  keep_editor_access?: boolean;
}

export interface AlbumMediaBatchUpdateDto {
  media_ids: Uuid[];
}

export interface ListAlbumMediaQuery {
  tag?: string[] | null;
  exclude_tag?: string[] | null;
  mode?: TagFilterMode;
  after?: string | null;
  page_size?: number;
}

export interface AlbumMediaListCache extends MediaCursorPage {
  query?: ListAlbumMediaQuery;
}

export type AlbumMutationResult = BulkResult;
