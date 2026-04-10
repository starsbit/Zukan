import { HttpErrorResponse } from '@angular/common/http';

export function extractApiError(err: unknown, fallback = 'An unexpected error occurred. Please try again.'): string {
  if (!(err instanceof HttpErrorResponse)) {
    return fallback;
  }

  if (err.status === 0) {
    return 'Network error - could not reach the server.';
  }

  if (err.error && typeof err.error === 'object') {
    const body = err.error as Record<string, unknown>;
    if (typeof body['detail'] === 'string' && body['detail']) return body['detail'];
    if (typeof body['message'] === 'string' && body['message']) return body['message'];
  }

  const statusText = err.statusText && err.statusText !== 'Unknown Error' ? err.statusText : null;
  return statusText
    ? `Server error: ${err.status} ${statusText}`
    : `Server error: ${err.status}`;
}
