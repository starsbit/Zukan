import { InjectionToken } from '@angular/core';

export const CLIENT_API_BASE_URL = new InjectionToken<string>(
  'CLIENT_API_BASE_URL',
  {
    providedIn: 'root',
    factory: () => 'http://127.0.0.1:8000'
  }
);
