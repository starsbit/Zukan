import type { Uuid } from './common.models';

export type BatchType = 'upload' | 'retag' | 'rethumbnail' | 'rescan';
export type BatchStatus = 'pending' | 'running' | 'partial_failed' | 'done' | 'failed' | 'cancelled';
export type BatchItemStatus = 'pending' | 'processing' | 'done' | 'failed' | 'skipped';

export interface ImportBatchRead {
  id: Uuid;
  user_id: Uuid;
  type: BatchType;
  status: BatchStatus;
  total_items: number;
  queued_items: number;
  processing_items: number;
  done_items: number;
  failed_items: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  app_version: string | null;
  worker_version: string | null;
  error_summary: string | null;
}

export interface ImportBatchItemRead {
  id: Uuid;
  batch_id: Uuid;
  media_id: Uuid | null;
  source_filename: string;
  status: BatchItemStatus;
  step: string | null;
  progress_percent: number | null;
  error: string | null;
  updated_at: string;
}

export interface ImportBatchListResponse {
  total: number;
  next_cursor: string | null;
  has_more: boolean;
  page_size: number;
  items: ImportBatchRead[];
}

export interface ImportBatchItemListResponse {
  total: number;
  next_cursor: string | null;
  has_more: boolean;
  page_size: number;
  items: ImportBatchItemRead[];
}

export interface ListImportBatchesQuery {
  after?: string | null;
  page_size?: number;
}

export interface ListImportBatchItemsQuery {
  after?: string | null;
  page_size?: number;
}
