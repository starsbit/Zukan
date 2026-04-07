export interface UploadResult {
  id: string | null;
  batch_item_id: string | null;
  original_filename: string;
  status: 'accepted' | 'duplicate' | 'error';
  message: string | null;
}

export interface BatchUploadResponse {
  batch_id: string;
  batch_url: string;
  batch_items_url: string;
  poll_after_seconds: number;
  webhooks_supported: boolean;
  accepted: number;
  duplicates: number;
  errors: number;
  results: UploadResult[];
}

export interface SetupRequiredResponse {
  setup_required: boolean;
}

export interface UploadConfigResponse {
  max_batch_size: number;
}

export interface TaggingJobQueuedResponse {
  queued: number;
}
