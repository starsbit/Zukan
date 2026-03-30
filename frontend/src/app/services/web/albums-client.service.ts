import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import {
  AlbumCreate,
  AlbumListResponse,
  AlbumOwnershipTransferRequest,
  AlbumRead,
  AlbumShareCreate,
  AlbumShareRead,
  AlbumUpdate,
} from '../../models/albums';
import { BulkResult, MediaIdsRequest } from '../../models/common';
import { MediaCursorPage } from '../../models/media';
import { TagFilterMode } from '../../models/media';

export interface AlbumListParams {
  after?: string;
  page_size?: number;
  sort_by?: 'name' | 'created_at';
  sort_order?: 'asc' | 'desc';
}

export interface AlbumMediaParams {
  tag?: string[];
  exclude_tag?: string[];
  mode?: TagFilterMode;
  after?: string;
  page_size?: number;
}

@Injectable({ providedIn: 'root' })
export class AlbumsClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  list(p: AlbumListParams = {}): Observable<AlbumListResponse> {
    let params = new HttpParams();
    if (p.after != null) params = params.set('after', p.after);
    if (p.page_size != null) params = params.set('page_size', p.page_size);
    if (p.sort_by != null) params = params.set('sort_by', p.sort_by);
    if (p.sort_order != null) params = params.set('sort_order', p.sort_order);
    return this.http.get<AlbumListResponse>(`${this.base}/api/v1/albums`, { params });
  }

  create(body: AlbumCreate): Observable<AlbumRead> {
    return this.http.post<AlbumRead>(`${this.base}/api/v1/albums`, body);
  }

  get(id: string): Observable<AlbumRead> {
    return this.http.get<AlbumRead>(`${this.base}/api/v1/albums/${id}`);
  }

  update(id: string, body: AlbumUpdate): Observable<AlbumRead> {
    return this.http.patch<AlbumRead>(`${this.base}/api/v1/albums/${id}`, body);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/v1/albums/${id}`);
  }

  listMedia(id: string, p: AlbumMediaParams = {}): Observable<MediaCursorPage> {
    let params = new HttpParams();
    if (p.tag) p.tag.forEach(t => (params = params.append('tag', t)));
    if (p.exclude_tag) p.exclude_tag.forEach(t => (params = params.append('exclude_tag', t)));
    if (p.mode != null) params = params.set('mode', p.mode);
    if (p.after != null) params = params.set('after', p.after);
    if (p.page_size != null) params = params.set('page_size', p.page_size);
    return this.http.get<MediaCursorPage>(`${this.base}/api/v1/albums/${id}/media`, { params });
  }

  addMedia(id: string, body: MediaIdsRequest): Observable<BulkResult> {
    return this.http.put<BulkResult>(`${this.base}/api/v1/albums/${id}/media`, body);
  }

  removeMedia(id: string, body: MediaIdsRequest): Observable<BulkResult> {
    return this.http.delete<BulkResult>(`${this.base}/api/v1/albums/${id}/media`, { body });
  }

  share(id: string, body: AlbumShareCreate): Observable<AlbumShareRead> {
    return this.http.post<AlbumShareRead>(`${this.base}/api/v1/albums/${id}/shares`, body);
  }

  revokeShare(albumId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/v1/albums/${albumId}/shares/${userId}`);
  }

  transferOwnership(
    id: string,
    body: AlbumOwnershipTransferRequest,
  ): Observable<AlbumRead> {
    return this.http.post<AlbumRead>(`${this.base}/api/v1/albums/${id}/owner/transfer`, body);
  }

  download(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/api/v1/albums/${id}/download`, { responseType: 'blob' });
  }
}
