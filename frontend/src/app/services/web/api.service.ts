import { HttpClient, HttpContext, HttpEvent, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { CLIENT_API_BASE_URL } from './api.config';
import { AUTH_MODE, type ClientAuthMode } from './auth.interceptor';

type QueryValue = string | number | boolean | null | undefined;

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

export interface ClientRequestOptions {
  auth?: ClientAuthMode;
  basicAuth?: BasicAuthCredentials;
  headers?: Record<string, string>;
  query?: object;
}

@Injectable({
  providedIn: 'root'
})
export class ClientApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(CLIENT_API_BASE_URL);

  get<T>(path: string, options?: ClientRequestOptions): Observable<T> {
    return this.http.get<T>(this.buildUrl(path), this.buildJsonOptions(options));
  }

  post<T>(path: string, body: unknown, options?: ClientRequestOptions): Observable<T> {
    return this.http.post<T>(this.buildUrl(path), body, this.buildJsonOptions(options));
  }

  postEvents<T>(path: string, body: unknown, options?: ClientRequestOptions): Observable<HttpEvent<T>> {
    return this.http.post<T>(this.buildUrl(path), body, {
      ...this.buildJsonOptions(options),
      observe: 'events',
      reportProgress: true
    });
  }

  postBlob(path: string, body: unknown, options?: ClientRequestOptions): Observable<Blob> {
    return this.http.post(this.buildUrl(path), body, this.buildBlobOptions(options));
  }

  put<T>(path: string, body: unknown, options?: ClientRequestOptions): Observable<T> {
    return this.http.put<T>(this.buildUrl(path), body, this.buildJsonOptions(options));
  }

  patch<T>(path: string, body: unknown, options?: ClientRequestOptions): Observable<T> {
    return this.http.patch<T>(this.buildUrl(path), body, this.buildJsonOptions(options));
  }

  delete<T>(path: string, options?: ClientRequestOptions & { body?: unknown }): Observable<T> {
    return this.http.delete<T>(this.buildUrl(path), {
      body: options?.body,
      context: this.buildContext(options),
      headers: this.buildHeaders(options),
      params: this.buildParams(options?.query)
    });
  }

  getBlob(path: string, options?: ClientRequestOptions): Observable<Blob> {
    return this.http.get(this.buildUrl(path), this.buildBlobOptions(options));
  }

  private buildJsonOptions(options?: ClientRequestOptions) {
    return {
      context: this.buildContext(options),
      headers: this.buildHeaders(options),
      params: this.buildParams(options?.query)
    };
  }

  private buildBlobOptions(options?: ClientRequestOptions) {
    return {
      context: this.buildContext(options),
      headers: this.buildHeaders(options),
      params: this.buildParams(options?.query),
      responseType: 'blob' as const
    };
  }

  private buildUrl(path: string): string {
    const normalizedBase = this.baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  private buildHeaders(options?: ClientRequestOptions): HttpHeaders {
    let headers = new HttpHeaders(options?.headers ?? {});

    if (options?.basicAuth) {
      const encoded = btoa(`${options.basicAuth.username}:${options.basicAuth.password}`);
      headers = headers.set('Authorization', `Basic ${encoded}`);
    }

    return headers;
  }

  private buildContext(options?: ClientRequestOptions): HttpContext {
    return new HttpContext().set(AUTH_MODE, options?.auth ?? 'required');
  }

  private buildParams(query?: object): HttpParams {
    let params = new HttpParams();

    if (!query) {
      return params;
    }

    for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          params = params.append(key, String(item));
        }
      } else {
        params = params.set(key, String(value as QueryValue));
      }
    }

    return params;
  }
}
