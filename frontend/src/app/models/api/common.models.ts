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

export interface BulkResult {
  processed: number;
  skipped: number;
}
