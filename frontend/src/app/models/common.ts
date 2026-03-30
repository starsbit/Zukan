export interface CursorPage<T> {
  total: number | null;
  next_cursor: string | null;
  has_more: boolean;
  page_size: number;
  items: T[];
}

export interface PagedList<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
}

export interface ErrorField {
  field: string;
  message: string;
  type: string | null;
}

export interface ErrorResponse {
  code: string;
  message: string;
  detail: string;
  status: number;
  request_id: string;
  trace_id: string;
  details: unknown | null;
  fields: ErrorField[] | null;
}

export interface BulkResult {
  processed: number;
  skipped: number;
}

export interface MediaIdsRequest {
  media_ids: string[];
}
