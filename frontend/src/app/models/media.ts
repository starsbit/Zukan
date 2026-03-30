import { CursorPage } from './common';
import { EntityRead, ExternalRefRead, ExternalRefCreate, EntityCreate } from './relations';

export enum MediaType {
  IMAGE = 'image',
  GIF = 'gif',
  VIDEO = 'video',
}

export enum TaggingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  DONE = 'done',
  FAILED = 'failed',
}

export enum ProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  DONE = 'done',
  FAILED = 'failed',
  NOT_APPLICABLE = 'not_applicable',
}

export enum MediaVisibility {
  PRIVATE = 'private',
  SHARED = 'shared',
  PUBLIC = 'public',
}

export enum MediaListState {
  ACTIVE = 'active',
  TRASHED = 'trashed',
}

export enum TagFilterMode {
  AND = 'and',
  OR = 'or',
}

export enum NsfwFilter {
  DEFAULT = 'default',
  ONLY = 'only',
  INCLUDE = 'include',
}

export interface MediaMetadata {
  file_size: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  frame_count: number | null;
  mime_type: string | null;
  captured_at: string;
}

export interface TagWithConfidence {
  name: string;
  category: number;
  category_name: string;
  category_key: string;
  confidence: number;
}

export interface MediaRead {
  id: string;
  uploader_id: string | null;
  uploader_username?: string | null;
  owner_id: string | null;
  owner_username?: string | null;
  visibility: MediaVisibility;
  filename: string;
  original_filename: string | null;
  media_type: MediaType;
  metadata: MediaMetadata;
  version: number;
  created_at: string;
  deleted_at: string | null;
  tags: string[];
  ocr_text_override: string | null;
  is_nsfw: boolean;
  tagging_status: TaggingStatus;
  tagging_error: string | null;
  thumbnail_status: ProcessingStatus;
  poster_status: ProcessingStatus;
  ocr_text: string | null;
  is_favorited: boolean;
  favorite_count: number;
  client_preview_url?: string | null;
  client_is_optimistic?: boolean;
  client_batch_id?: string | null;
  client_source_filename?: string | null;
}

export interface MediaDetail extends MediaRead {
  tag_details: TagWithConfidence[];
  external_refs: ExternalRefRead[];
  entities: EntityRead[];
}

export interface MediaMetadataUpdate {
  captured_at: string | null;
}

export interface MediaUpdate {
  tags?: string[] | null;
  entities?: EntityCreate[] | null;
  metadata?: MediaMetadataUpdate | null;
  deleted?: boolean | null;
  favorited?: boolean | null;
  visibility?: MediaVisibility | null;
  ocr_text_override?: string | null;
  external_refs?: ExternalRefCreate[] | null;
  version?: number | null;
}

export type MediaCursorPage = CursorPage<MediaRead>;

export interface MediaListParams {
  after?: string;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  state?: MediaListState;
  visibility?: MediaVisibility;
  tags?: string[];
  tag_mode?: TagFilterMode;
  nsfw_filter?: NsfwFilter;
  include_total?: boolean;
  search?: string;
  captured_year?: number;
  captured_month?: number;
  captured_day?: number;
  captured_after?: string;
  captured_before?: string;
  captured_before_year?: number;
}

export interface MediaBatchUpdate {
  media_ids: string[];
  deleted?: boolean | null;
  favorited?: boolean | null;
  visibility?: MediaVisibility | null;
}
