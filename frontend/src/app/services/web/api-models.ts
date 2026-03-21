export type Uuid = string;

export interface ValidationError {
  loc: Array<string | number>;
  msg: string;
  type: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}

export interface HttpValidationError {
  detail?: ValidationError[];
}

export interface UserRegisterDto {
  username: string;
  email: string;
  password: string;
}

export interface UserLoginDto {
  username: string;
  password: string;
  remember_me?: boolean;
}

export interface RefreshRequestDto {
  refresh_token: string;
}

export interface LogoutRequestDto {
  refresh_token: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
}

export interface AccessTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
}

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

export interface TagRead {
  id: number;
  name: string;
  category: number;
  category_name: string;
  media_count: number;
}

export interface TagWithConfidence {
  name: string;
  category: number;
  category_name: string;
  confidence: number;
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

export interface BulkResult {
  processed: number;
  skipped: number;
}

export interface MediaListResponse {
  total: number;
  page: number;
  page_size: number;
  items: MediaRead[];
}

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

export interface ListMediaQuery {
  state?: MediaListState;
  tags?: string | null;
  character_name?: string | null;
  exclude_tags?: string | null;
  mode?: TagFilterMode;
  nsfw?: NsfwFilter;
  status?: string | null;
  favorited?: boolean | null;
  page?: number;
  page_size?: number;
  captured_year?: number | null;
  captured_month?: number | null;
  captured_day?: number | null;
  captured_before_year?: number | null;
}

export interface ListTagsQuery {
  limit?: number;
  offset?: number;
  category?: number | null;
  q?: string | null;
}

export interface ListAlbumMediaQuery {
  tags?: string | null;
  exclude_tags?: string | null;
  mode?: TagFilterMode;
  page?: number;
  page_size?: number;
}

export interface ListAdminUsersQuery {
  page?: number;
  page_size?: number;
}
