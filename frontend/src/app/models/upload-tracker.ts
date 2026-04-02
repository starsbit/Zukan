import { BatchItemStatus, BatchStatus, ImportBatchRead, ProcessingStep } from './processing';
import { TaggingStatus } from './media';

export type UploadRequestState = 'queued' | 'uploading' | 'completed' | 'failed';

export type UploadStatusFilter =
  | 'pending'
  | 'processing'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'duplicate'
  | 'upload_error';

export interface UploadStatusCount {
  filter: UploadStatusFilter;
  label: string;
  count: number;
}

export interface UploadStatusDialogItem {
  id: string;
  filter: UploadStatusFilter;
  filename: string;
  error: string | null;
  previewMediaId: string | null;
  batchId: string | null;
  statusLabel: string;
  stepLabel: string | null;
  progressPercent: number | null;
  updatedAt: string | null;
}

export interface UploadStatusSummary {
  requestCounts: Record<UploadRequestState, number>;
  itemCounts: Record<UploadStatusFilter, number>;
  reviewItems: number;
  reviewBatchCount: number;
  latestReviewBatchId: string | null;
  totalTrackedItems: number;
  completedItems: number;
  progressPercent: number;
  activeBatchCount: number;
  hasActiveWork: boolean;
  latestBatch: ImportBatchRead | null;
}

export function isTerminalBatchStatus(status: BatchStatus): boolean {
  return status === BatchStatus.DONE
    || status === BatchStatus.FAILED
    || status === BatchStatus.PARTIAL_FAILED
    || status === BatchStatus.CANCELLED;
}

export function filterLabel(filter: UploadStatusFilter): string {
  switch (filter) {
    case 'pending':
      return 'Pending';
    case 'processing':
      return 'Processing';
    case 'done':
      return 'Processed';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    case 'duplicate':
      return 'Duplicates';
    case 'upload_error':
      return 'Upload errors';
  }
}

export function batchItemFilter(status: BatchItemStatus): UploadStatusFilter {
  switch (status) {
    case BatchItemStatus.PENDING:
      return 'pending';
    case BatchItemStatus.PROCESSING:
      return 'processing';
    case BatchItemStatus.DONE:
      return 'done';
    case BatchItemStatus.FAILED:
      return 'failed';
    case BatchItemStatus.SKIPPED:
      return 'skipped';
  }
}

export function batchItemStatusLabel(status: BatchItemStatus): string {
  switch (status) {
    case BatchItemStatus.PENDING:
      return 'Pending';
    case BatchItemStatus.PROCESSING:
      return 'Processing';
    case BatchItemStatus.DONE:
      return 'Processed';
    case BatchItemStatus.FAILED:
      return 'Failed';
    case BatchItemStatus.SKIPPED:
      return 'Skipped';
  }
}

export function processingStepLabel(step: ProcessingStep | null): string | null {
  switch (step) {
    case ProcessingStep.INGEST:
      return 'Ingest';
    case ProcessingStep.THUMBNAIL:
      return 'Thumbnail';
    case ProcessingStep.POSTER:
      return 'Poster';
    case ProcessingStep.TAG:
      return 'Tagging';
    case ProcessingStep.OCR:
      return 'OCR';
    case null:
      return null;
  }
}

export function taggingStatusFilter(status: TaggingStatus): UploadStatusFilter {
  switch (status) {
    case TaggingStatus.PENDING:
      return 'pending';
    case TaggingStatus.PROCESSING:
      return 'processing';
    case TaggingStatus.DONE:
      return 'done';
    case TaggingStatus.FAILED:
      return 'failed';
  }
}

export function taggingStatusLabel(status: TaggingStatus): string {
  switch (status) {
    case TaggingStatus.PENDING:
      return 'Pending';
    case TaggingStatus.PROCESSING:
      return 'Processing';
    case TaggingStatus.DONE:
      return 'Processed';
    case TaggingStatus.FAILED:
      return 'Failed';
  }
}
