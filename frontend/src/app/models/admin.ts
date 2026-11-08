import { UserRead } from './auth';
import { PagedList } from './common';

export interface AdminStatsResponse {
  total_media: number;
  total_storage_bytes: number;
  pending_tagging: number;
  failed_tagging: number;
  trashed_media: number;
}

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

export interface AdminLibraryClassificationSourceMetricsRead {
  source: string;
  reviewed: number;
  accepted: number;
  rejected: number;
  auto_applied: number;
  acceptance_rate: number | null;
}

export interface AdminLibraryClassificationMetricsResponse {
  user_id: string;
  model_version: string;
  reviewed: number;
  accepted: number;
  rejected: number;
  auto_applied: number;
  acceptance_rate: number | null;
  rejection_rate: number | null;
  by_source: AdminLibraryClassificationSourceMetricsRead[];
}

export interface AdminTaggerOption {
  id: string;
  label: string;
  description: string;
  download_size_bytes: number;
}

export interface AdminTaggerStatus {
  active: string;
  status: 'loading' | 'ready' | 'failed';
  target: string | null;
  error: string | null;
  execution_provider: string | null;
  options: AdminTaggerOption[];
}
