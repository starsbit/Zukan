import type { BulkResult, Uuid } from './common.models';
import type { MediaListResponse, TagFilterMode } from './media.models';

export interface AlbumCreateDto {
  name: string;
  description?: string | null;
}

export interface AlbumUpdateDto {
  name?: string | null;
  description?: string | null;
  cover_media_id?: Uuid | null;
}

export interface AlbumRead {
  id: Uuid;
  owner_id: Uuid;
  name: string;
  description: string | null;
  cover_media_id: Uuid | null;
  media_count?: number;
  created_at: string;
  updated_at: string;
}

export interface AlbumShareCreateDto {
  user_id: Uuid;
  can_edit?: boolean;
}

export interface AlbumShareRead {
  user_id: Uuid;
  can_edit: boolean;
}

export interface AlbumMediaBatchUpdateDto {
  media_ids: Uuid[];
}

export interface ListAlbumMediaQuery {
  tag?: string[] | null;
  exclude_tag?: string[] | null;
  mode?: TagFilterMode;
  page?: number;
  page_size?: number;
}

export interface AlbumMediaListCache extends MediaListResponse {
  query?: ListAlbumMediaQuery;
}

export type AlbumMutationResult = BulkResult;
