import type { BulkResult, Uuid } from './common.models';
import type { TagWithConfidence } from './tag.models';

export type MediaType = 'image' | 'gif' | 'video';
export type MediaListState = 'active' | 'trashed';
export type TagFilterMode = 'and' | 'or';
export type NsfwFilter = 'default' | 'only' | 'include';
export type MediaEntityType = 'character';

export interface EntityRead {
  id: Uuid;
  entity_type: MediaEntityType;
  entity_id: Uuid | null;
  name: string;
  role: string;
  source: string;
  confidence: number | null;
}

export interface EntityCreateDto {
  entity_type: MediaEntityType;
  entity_id?: Uuid | null;
  name: string;
  role?: string;
  confidence?: number | null;
}

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

export interface ExternalRefRead {
  id: Uuid;
  provider: string;
  external_id: string | null;
  url: string | null;
}

export interface ExternalRefCreateDto {
  provider: string;
  external_id?: string | null;
  url?: string | null;
}

export interface MediaRead {
  id: Uuid;
  uploader_id: Uuid | null;
  filename: string;
  original_filename: string | null;
  media_type?: MediaType;
  metadata: MediaMetadata;
  tags: string[];
  is_nsfw: boolean;
  tagging_status: string;
  tagging_error?: string | null;
  thumbnail_status: string;
  poster_status?: string;
  ocr_text?: string | null;
  ocr_text_override?: string | null;
  version: number;
  created_at: string;
  deleted_at: string | null;
  is_favorited?: boolean;
}

export interface MediaDetail extends MediaRead {
  tag_details?: TagWithConfidence[];
  external_refs?: ExternalRefRead[];
  entities?: EntityRead[];
}

export interface MediaUpdateDto {
  tags?: string[] | null;
  entities?: EntityCreateDto[] | null;
  metadata?: MediaMetadataUpdateDto | null;
  deleted?: boolean | null;
  favorited?: boolean | null;
  ocr_text_override?: string | null;
  external_refs?: ExternalRefCreateDto[] | null;
  version?: number | null;
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
  batch_item_id?: Uuid | null;
  original_filename: string;
  status: UploadStatus;
  message?: string | null;
}

export interface BatchUploadResponse {
  batch_id: Uuid;
  batch_url: string;
  batch_items_url: string;
  poll_after_seconds: number;
  webhooks_supported: boolean;
  accepted: number;
  duplicates: number;
  errors: number;
  results: UploadResult[];
}

export interface UploadConfig {
  max_batch_size: number;
  max_upload_size_mb: number;
}

export interface MediaListResponse {
  total: number;
  page: number;
  page_size: number;
  items: MediaRead[];
}

export interface MediaCursorPage {
  total: number | null;
  next_cursor: string | null;
  page_size: number;
  items: MediaRead[];
}

export interface CharacterSuggestion {
  name: string;
  media_count: number;
}

export interface ListMediaQuery {
  state?: MediaListState;
  album_id?: Uuid | null;
  tag?: string[] | null;
  character_name?: string | null;
  exclude_tag?: string[] | null;
  mode?: TagFilterMode;
  nsfw?: NsfwFilter;
  status?: string | null;
  favorited?: boolean | null;
  media_type?: MediaType[] | null;
  after?: string | null;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  captured_year?: number | null;
  captured_month?: number | null;
  captured_day?: number | null;
  captured_after?: string | null;
  captured_before?: string | null;
  captured_before_year?: number | null;
  ocr_text?: string | null;
}

export type MediaListCache = MediaCursorPage & { query?: ListMediaQuery };

export type MediaMutationResult = BulkResult;
