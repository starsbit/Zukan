import { HttpErrorResponse } from '@angular/common/http';

export function extractApiError(err: unknown): string {
  if (err instanceof HttpErrorResponse && err.error && typeof err.error === 'object') {
    const body = err.error as Record<string, unknown>;
    if (typeof body['detail'] === 'string' && body['detail']) return body['detail'];
    if (typeof body['message'] === 'string' && body['message']) return body['message'];
  }
  return 'An unexpected error occurred. Please try again.';
}
