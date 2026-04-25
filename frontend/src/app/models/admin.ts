import { UserRead } from './auth';
import { PagedList } from './common';

export interface AdminUserUpdate {
  username?: string | null;
  is_admin?: boolean | null;
  show_nsfw?: boolean | null;
  show_sensitive?: boolean | null;
  tag_confidence_threshold?: number | null;
  password?: string | null;
  storage_quota_mb?: number | null;
}

export interface AdminUserSummary extends UserRead {
  media_count: number;
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

export type EmbeddingClusterMode = 'label' | 'unsupervised';

export interface AdminEmbeddingBackfillResponse {
  batch_id: string | null;
  queued: number;
  already_current: number;
}

export interface AdminEmbeddingBackfillStatus {
  batch_id: string;
  user_id: string;
  status: string;
  total_items: number;
  queued_items: number;
  processing_items: number;
  done_items: number;
  failed_items: number;
  started_at: string | null;
  finished_at: string | null;
  error_summary: string | null;
  recent_failed_items: string[];
}

export interface AdminEmbeddingClusterSampleRead {
  media_id: string;
  filename: string;
  similarity: number | null;
  label: string | null;
}

export interface AdminEmbeddingClusterRead {
  id: string;
  label: string | null;
  entity_id: string | null;
  size: number;
  distinct_media_support: number;
  prototype_count: number;
  cohesion: number | null;
  min_similarity: number | null;
  max_similarity: number | null;
  nearest_labels: string[];
  samples: AdminEmbeddingClusterSampleRead[];
  outliers: AdminEmbeddingClusterSampleRead[];
}

export interface AdminEmbeddingClusterListResponse {
  mode: EmbeddingClusterMode;
  model_version: string;
  total_embeddings: number;
  clusters: AdminEmbeddingClusterRead[];
}

export type UserListResponse = PagedList<AdminUserSummary>;

export interface UpdateCheckResponse {
  current_version: string;
  latest_version: string | null;
  up_to_date: boolean;
  message: string;
}
