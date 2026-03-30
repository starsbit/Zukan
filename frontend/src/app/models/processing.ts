import { CursorPage } from './common';

export enum BatchType {
  UPLOAD = 'upload',
  RETAG = 'retag',
  RETHUMBNAIL = 'rethumbnail',
  RESCAN = 'rescan',
}

export enum BatchStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PARTIAL_FAILED = 'partial_failed',
  DONE = 'done',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum BatchItemStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  DONE = 'done',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export enum ProcessingStep {
  INGEST = 'ingest',
  THUMBNAIL = 'thumbnail',
  POSTER = 'poster',
  TAG = 'tag',
  OCR = 'ocr',
}

export interface ImportBatchRead {
  id: string;
  user_id: string;
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
  id: string;
  batch_id: string;
  media_id: string | null;
  source_filename: string;
  status: BatchItemStatus;
  step: ProcessingStep | null;
  progress_percent: number | null;
  error: string | null;
  updated_at: string;
}

export type ImportBatchListResponse = CursorPage<ImportBatchRead>;
export type ImportBatchItemListResponse = CursorPage<ImportBatchItemRead>;
