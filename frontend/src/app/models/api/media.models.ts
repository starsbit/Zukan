import type { BulkResult, Uuid } from './common.models';
import type { TagWithConfidence } from './tag.models';

export type MediaType = 'image' | 'gif' | 'video';
export type MediaListState = 'active' | 'trashed';
export type TagFilterMode = 'and' | 'or';
export type NsfwFilter = 'default' | 'only' | 'include';

export interface MediaMetadata {
  file_size: number | null;
  width: number | null;
  height: number | null;
  duration_seconds?: number | null;
  frame_count?: number | null;
  mime_type: string | null;
  captured_at: string;
}

export interface MediaMetadataUpdateDto {
  captured_at?: string | null;
}

export interface MediaRead {
  id: Uuid;
  uploader_id: Uuid | null;
  filename: string;
  original_filename: string | null;
  media_type?: MediaType;
  metadata: MediaMetadata;
  tags: string[];
  character_name?: string | null;
  is_nsfw: boolean;
  tagging_status: string;
  tagging_error?: string | null;
  thumbnail_status: string;
  poster_status?: string;
  created_at: string;
  deleted_at: string | null;
  is_favorited?: boolean;
}

export interface MediaDetail extends MediaRead {
  tag_details?: TagWithConfidence[];
}

export interface MediaUpdateDto {
  tags?: string[] | null;
  character_name?: string | null;
  metadata?: MediaMetadataUpdateDto | null;
  deleted?: boolean | null;
  favorited?: boolean | null;
}

export interface MediaBatchUpdateDto {
  media_ids: Uuid[];
  deleted?: boolean | null;
  favorited?: boolean | null;
}

export interface MediaBatchDeleteDto {
  media_ids: Uuid[];
}

export interface DownloadRequestDto {
  media_ids: Uuid[];
}

export interface TaggingJobQueuedResponse {
  queued: number;
}

export type UploadStatus = 'accepted' | 'duplicate' | 'error';

export interface UploadResult {
  id: Uuid | null;
  original_filename: string;
  status: UploadStatus;
  message?: string | null;
}

export interface BatchUploadResponse {
  accepted: number;
  duplicates: number;
  errors: number;
  results: UploadResult[];
}

export interface MediaListResponse {
  total: number;
  page: number;
  page_size: number;
  items: MediaRead[];
}

export interface CharacterSuggestion {
  name: string;
  media_count: number;
}

export interface ListMediaQuery {
  state?: MediaListState;
  tags?: string | null;
  character_name?: string | null;
  exclude_tags?: string | null;
  mode?: TagFilterMode;
  nsfw?: NsfwFilter;
  status?: string[] | string | null;
  favorited?: boolean | null;
  media_type?: MediaType[] | MediaType | null;
  page?: number;
  page_size?: number;
  captured_year?: number | null;
  captured_month?: number | null;
  captured_day?: number | null;
  captured_after?: string | null;
  captured_before?: string | null;
  captured_before_year?: number | null;
}

export type MediaListCache = MediaListResponse & { query?: ListMediaQuery };

export type MediaMutationResult = BulkResult;
