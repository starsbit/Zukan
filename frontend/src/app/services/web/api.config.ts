import { InjectionToken } from '@angular/core';

export const CLIENT_API_BASE_URL = new InjectionToken<string>(
  'CLIENT_API_BASE_URL',
  {
    providedIn: 'root',
    factory: () => resolveClientApiBaseUrl()
  }
);

function resolveClientApiBaseUrl(): string {
  try {
    const override = globalThis.localStorage?.getItem('zukan.web.api_base_url')?.trim();
    if (override) {
      return override;
    }
  } catch {
    // Ignore storage access failures and fall back to the default API URL.
  }

  return 'http://127.0.0.1:8000/api/v1';
}
