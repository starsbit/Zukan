import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import {
  MediaCursorPage,
  MediaDetail,
  MediaUpdate,
  MediaBatchUpdate,
  MediaEntityBatchUpdate,
  MediaListState,
  MediaVisibility,
  TagFilterMode,
  NsfwFilter,
  SensitiveFilter,
} from '../../models/media';
import { BulkResult, MediaIdsRequest } from '../../models/common';
import { BatchUploadResponse, TaggingJobQueuedResponse } from '../../models/uploads';
import { CharacterSuggestion, MetadataListScope, SeriesSuggestion } from '../../models/tags';
import { MediaTimeline } from '../../models/timeline';
import { normalizeMetadataNameForSubmission } from '../../utils/media-display.utils';

export interface MediaListParams {
  state?: MediaListState;
  album_id?: string;
  visibility?: MediaVisibility;
  sort_by?: 'captured_at' | 'created_at' | 'filename' | 'file_size';
  sort_order?: 'asc' | 'desc';
  after?: string;
  page_size?: number;
  include_total?: boolean;
}

export interface MediaSearchParams {
  state?: MediaListState;
  album_id?: string;
  tag?: string[];
  character_name?: string;
  series_name?: string;
  exclude_tag?: string[];
  mode?: TagFilterMode;
  nsfw?: NsfwFilter;
  sensitive?: SensitiveFilter;
  status?: string;
  favorited?: boolean;
  visibility?: MediaVisibility;
  media_type?: string[];
  sort_by?: 'captured_at' | 'created_at' | 'filename' | 'file_size';
  sort_order?: 'asc' | 'desc';
  after?: string;
  page_size?: number;
  ocr_text?: string;
  include_total?: boolean;
  captured_year?: number;
  captured_month?: number;
  captured_day?: number;
  captured_after?: string;
  captured_before?: string;
  captured_before_year?: number;
}

export interface UploadParams {
  album_id?: string;
  tags?: string[];
  captured_at?: string;
  captured_at_values?: string[];
  visibility?: MediaVisibility;
  idempotencyKey?: string;
}

@Injectable({ providedIn: 'root' })
export class MediaClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  list(p: MediaListParams = {}): Observable<MediaCursorPage> {
    let params = new HttpParams();
    if (p.state != null) params = params.set('state', p.state);
    if (p.album_id != null) params = params.set('album_id', p.album_id);
    if (p.visibility != null) params = params.set('visibility', p.visibility);
    if (p.sort_by != null) params = params.set('sort_by', p.sort_by);
    if (p.sort_order != null) params = params.set('sort_order', p.sort_order);
    if (p.after != null) params = params.set('after', p.after);
    if (p.page_size != null) params = params.set('page_size', p.page_size);
    if (p.include_total != null) params = params.set('include_total', p.include_total);
    return this.http.get<MediaCursorPage>(`${this.base}/api/v1/media`, { params });
  }

  search(p: MediaSearchParams = {}): Observable<MediaCursorPage> {
    let params = new HttpParams();
    if (p.state != null) params = params.set('state', p.state);
    if (p.album_id != null) params = params.set('album_id', p.album_id);
    if (p.tag) p.tag.forEach(t => (params = params.append('tag', normalizeMetadataValue(t))));
    if (p.character_name != null) params = params.set('character_name', normalizeMetadataValue(p.character_name));
    if (p.series_name != null) params = params.set('series_name', normalizeMetadataValue(p.series_name));
    if (p.exclude_tag) p.exclude_tag.forEach(t => (params = params.append('exclude_tag', normalizeMetadataValue(t))));
    if (p.mode != null) params = params.set('mode', p.mode);
    if (p.nsfw != null) params = params.set('nsfw', p.nsfw);
    if (p.sensitive != null) params = params.set('sensitive', p.sensitive);
    if (p.status != null) params = params.set('status', p.status);
    if (p.favorited != null) params = params.set('favorited', p.favorited);
    if (p.visibility != null) params = params.set('visibility', p.visibility);
    if (p.media_type) p.media_type.forEach(t => (params = params.append('media_type', t)));
    if (p.sort_by != null) params = params.set('sort_by', p.sort_by);
    if (p.sort_order != null) params = params.set('sort_order', p.sort_order);
    if (p.after != null) params = params.set('after', p.after);
    if (p.page_size != null) params = params.set('page_size', p.page_size);
    if (p.ocr_text != null) params = params.set('ocr_text', p.ocr_text);
    if (p.include_total != null) params = params.set('include_total', p.include_total);
    if (p.captured_year != null) params = params.set('captured_year', p.captured_year);
    if (p.captured_month != null) params = params.set('captured_month', p.captured_month);
    if (p.captured_day != null) params = params.set('captured_day', p.captured_day);
    if (p.captured_after != null) params = params.set('captured_after', p.captured_after);
    if (p.captured_before != null) params = params.set('captured_before', p.captured_before);
    if (p.captured_before_year != null)
      params = params.set('captured_before_year', p.captured_before_year);
    return this.http.get<MediaCursorPage>(`${this.base}/api/v1/media/search`, { params });
  }

  upload(files: File[], p: UploadParams = {}): Observable<HttpEvent<BatchUploadResponse>> {
    const form = new FormData();
    files.forEach(f => form.append('files', f));
    if (p.album_id != null) form.append('album_id', p.album_id);
    if (p.tags) p.tags.forEach(t => form.append('tags', normalizeMetadataValue(t)));
    if (p.captured_at != null) form.append('captured_at', p.captured_at);
    if (p.captured_at_values)
      p.captured_at_values.forEach(v => form.append('captured_at_values', v));
    if (p.visibility != null) form.append('visibility', p.visibility);
    const headers: Record<string, string> = {};
    if (p.idempotencyKey) headers['Idempotency-Key'] = p.idempotencyKey;
    return this.http.post<BatchUploadResponse>(`${this.base}/api/v1/media`, form, {
      headers,
      reportProgress: true,
      observe: 'events',
    });
  }

  batchUpdate(body: MediaBatchUpdate): Observable<BulkResult> {
    return this.http.patch<BulkResult>(`${this.base}/api/v1/media`, body);
  }

  batchUpdateEntities(body: MediaEntityBatchUpdate): Observable<BulkResult> {
    return this.http.patch<BulkResult>(`${this.base}/api/v1/media/entities`, {
      ...body,
      character_names: body.character_names?.map((name) => normalizeMetadataValue(name)),
      series_names: body.series_names?.map((name) => normalizeMetadataValue(name)),
    });
  }

  batchDelete(body: MediaIdsRequest): Observable<BulkResult> {
    return this.http.post<BulkResult>(`${this.base}/api/v1/media/actions/delete`, body);
  }

  batchPurge(body: MediaIdsRequest): Observable<BulkResult> {
    return this.http.post<BulkResult>(`${this.base}/api/v1/media/actions/purge`, body);
  }

  emptyTrash(): Observable<void> {
    return this.http.post<void>(`${this.base}/api/v1/media/actions/empty-trash`, null);
  }

  download(body: MediaIdsRequest): Observable<Blob> {
    return this.http.post(`${this.base}/api/v1/media/download`, body, {
      responseType: 'blob',
    });
  }

  getTimeline(p: Omit<MediaSearchParams, 'after' | 'page_size' | 'include_total' | 'captured_year' | 'captured_month' | 'captured_day' | 'captured_after' | 'captured_before' | 'captured_before_year'> = {}): Observable<MediaTimeline> {
    let params = new HttpParams();
    if (p.state != null) params = params.set('state', p.state);
    if (p.album_id != null) params = params.set('album_id', p.album_id);
    if (p.tag) p.tag.forEach(t => (params = params.append('tag', normalizeMetadataValue(t))));
    if (p.character_name != null) params = params.set('character_name', normalizeMetadataValue(p.character_name));
    if (p.series_name != null) params = params.set('series_name', normalizeMetadataValue(p.series_name));
    if (p.exclude_tag) p.exclude_tag.forEach(t => (params = params.append('exclude_tag', normalizeMetadataValue(t))));
    if (p.mode != null) params = params.set('mode', p.mode);
    if (p.nsfw != null) params = params.set('nsfw', p.nsfw);
    if (p.sensitive != null) params = params.set('sensitive', p.sensitive);
    if (p.status != null) params = params.set('status', p.status);
    if (p.favorited != null) params = params.set('favorited', p.favorited);
    if (p.visibility != null) params = params.set('visibility', p.visibility);
    if (p.media_type) p.media_type.forEach(t => (params = params.append('media_type', t)));
    if (p.ocr_text != null) params = params.set('ocr_text', p.ocr_text);
    return this.http.get<MediaTimeline>(`${this.base}/api/v1/media/timeline`, { params });
  }

  getCharacterSuggestions(q: string, limit = 20, scope?: MetadataListScope): Observable<CharacterSuggestion[]> {
    let params = new HttpParams().set('q', normalizeMetadataQuery(q)).set('limit', limit);
    if (scope != null) params = params.set('scope', scope);
    return this.http.get<CharacterSuggestion[]>(
      `${this.base}/api/v1/media/character-suggestions`,
      { params },
    );
  }

  getSeriesSuggestions(q: string, limit = 20, scope?: MetadataListScope): Observable<SeriesSuggestion[]> {
    let params = new HttpParams().set('q', normalizeMetadataQuery(q)).set('limit', limit);
    if (scope != null) params = params.set('scope', scope);
    return this.http.get<SeriesSuggestion[]>(
      `${this.base}/api/v1/media/series-suggestions`,
      { params },
    );
  }

  get(id: string): Observable<MediaDetail> {
    return this.http.get<MediaDetail>(`${this.base}/api/v1/media/${id}`);
  }

  update(id: string, body: MediaUpdate): Observable<MediaDetail> {
    return this.http.patch<MediaDetail>(`${this.base}/api/v1/media/${id}`, normalizeMediaUpdate(body));
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/v1/media/${id}`);
  }

  restore(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/api/v1/media/${id}/restore`, null);
  }

  purge(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/v1/media/${id}/purge`);
  }

  queueTaggingJob(id: string): Observable<TaggingJobQueuedResponse> {
    return this.http.post<TaggingJobQueuedResponse>(
      `${this.base}/api/v1/media/${id}/tagging-jobs`,
      null,
    );
  }

  batchQueueTaggingJobs(body: MediaIdsRequest): Observable<TaggingJobQueuedResponse> {
    return this.http.post<TaggingJobQueuedResponse>(
      `${this.base}/api/v1/media/tagging-jobs`,
      body,
    );
  }

  getFile(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/api/v1/media/${id}/file`, { responseType: 'blob' });
  }

  getThumbnail(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/api/v1/media/${id}/thumbnail`, { responseType: 'blob' });
  }

  getPoster(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/api/v1/media/${id}/poster`, { responseType: 'blob' });
  }
}

function normalizeMetadataValue(value: string): string {
  return normalizeMetadataNameForSubmission(value) || value.trim();
}

function normalizeMetadataQuery(value: string): string {
  return normalizeMetadataValue(value);
}

function normalizeMediaUpdate(body: MediaUpdate): MediaUpdate {
  return {
    ...body,
    tags: body.tags?.map((tag) => normalizeMetadataValue(tag)),
    entities: body.entities?.map((entity) => ({
      ...entity,
      name: normalizeMetadataValue(entity.name),
    })),
  };
}
