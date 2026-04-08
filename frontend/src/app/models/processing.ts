import { CursorPage } from './common';
import { MediaRead } from './media';
import { EntityRead } from './relations';

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

export interface ImportBatchReviewItemRead {
  batch_item_id: string;
  media: MediaRead;
  entities: EntityRead[];
  source_filename: string;
  missing_character: boolean;
  missing_series: boolean;
}

export interface ImportBatchRecommendationSuggestionRead {
  name: string;
  confidence: number;
}

export interface ImportBatchRecommendationSignalRead {
  kind: 'tag' | 'visual' | 'ocr' | 'entity';
  label: string;
  confidence: number | null;
}

export interface ImportBatchRecommendationGroupRead {
  id: string;
  media_ids: string[];
  item_count: number;
  missing_character_count: number;
  missing_series_count: number;
  suggested_characters: ImportBatchRecommendationSuggestionRead[];
  suggested_series: ImportBatchRecommendationSuggestionRead[];
  shared_signals: ImportBatchRecommendationSignalRead[];
  confidence: number;
}

export interface ImportBatchReviewListResponse {
  total: number;
  items: ImportBatchReviewItemRead[];
  recommendation_groups: ImportBatchRecommendationGroupRead[];
}

export interface ImportBatchReviewSummaryResponse {
  unresolved_count: number;
  review_batch_ids: string[];
  latest_batch_id: string | null;
  latest_batch_created_at: string | null;
}
