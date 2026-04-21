import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { MetadataListScope, MetadataNameListResponse, TagListResponse, TagManagementResult } from '../../models/tags';
import { normalizeMetadataNameForSubmission } from '../../utils/media-display.utils';

export interface TagListParams {
  after?: string;
  page_size?: number;
  category?: number;
  q?: string;
  sort_by?: 'name' | 'media_count';
  sort_order?: 'asc' | 'desc';
  scope?: MetadataListScope;
}

export interface MetadataNameListParams {
  after?: string;
  page_size?: number;
  q?: string;
  sort_by?: 'name' | 'media_count';
  sort_order?: 'asc' | 'desc';
  scope?: MetadataListScope;
}

@Injectable({ providedIn: 'root' })
export class TagsClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  list(p: TagListParams = {}): Observable<TagListResponse> {
    let params = new HttpParams();
    if (p.after != null) params = params.set('after', p.after);
    if (p.page_size != null) params = params.set('page_size', p.page_size);
    if (p.category != null) params = params.set('category', p.category);
    if (p.q != null) params = params.set('q', normalizeMetadataQuery(p.q));
    if (p.sort_by != null) params = params.set('sort_by', p.sort_by);
    if (p.sort_order != null) params = params.set('sort_order', p.sort_order);
    if (p.scope != null) params = params.set('scope', p.scope);
    return this.http.get<TagListResponse>(`${this.base}/api/v1/tags`, { params });
  }

  listCharacterNames(p: MetadataNameListParams = {}): Observable<MetadataNameListResponse> {
    return this.listMetadataNames('/api/v1/character-names', p);
  }

  listSeriesNames(p: MetadataNameListParams = {}): Observable<MetadataNameListResponse> {
    return this.listMetadataNames('/api/v1/series-names', p);
  }

  removeFromMedia(tagId: number): Observable<TagManagementResult> {
    return this.http.post<TagManagementResult>(
      `${this.base}/api/v1/tags/${tagId}/actions/remove-from-media`,
      null,
    );
  }

  merge(tagId: number, targetTagId: number): Observable<TagManagementResult> {
    return this.http.post<TagManagementResult>(
      `${this.base}/api/v1/tags/${tagId}/actions/merge`,
      { target_tag_id: targetTagId },
    );
  }

  trashMedia(tagId: number): Observable<TagManagementResult> {
    return this.http.post<TagManagementResult>(
      `${this.base}/api/v1/tags/${tagId}/actions/trash-media`,
      null,
    );
  }

  removeCharacterFromMedia(characterName: string): Observable<TagManagementResult> {
    return this.http.post<TagManagementResult>(
      `${this.base}/api/v1/character-names/${encodeMetadataPathSegment(characterName)}/actions/remove-from-media`,
      null,
    );
  }

  mergeCharacterName(characterName: string, targetName: string): Observable<TagManagementResult> {
    return this.http.post<TagManagementResult>(
      `${this.base}/api/v1/character-names/${encodeMetadataPathSegment(characterName)}/actions/merge`,
      { target_name: targetName.trim() },
    );
  }

  trashMediaByCharacter(characterName: string): Observable<TagManagementResult> {
    return this.http.post<TagManagementResult>(
      `${this.base}/api/v1/character-names/${encodeMetadataPathSegment(characterName)}/actions/trash-media`,
      null,
    );
  }

  removeSeriesFromMedia(seriesName: string): Observable<TagManagementResult> {
    return this.http.post<TagManagementResult>(
      `${this.base}/api/v1/series-names/${encodeMetadataPathSegment(seriesName)}/actions/remove-from-media`,
      null,
    );
  }

  mergeSeriesName(seriesName: string, targetName: string): Observable<TagManagementResult> {
    return this.http.post<TagManagementResult>(
      `${this.base}/api/v1/series-names/${encodeMetadataPathSegment(seriesName)}/actions/merge`,
      { target_name: targetName.trim() },
    );
  }

  private listMetadataNames(endpoint: string, p: MetadataNameListParams): Observable<MetadataNameListResponse> {
    let params = new HttpParams();
    if (p.after != null) params = params.set('after', p.after);
    if (p.page_size != null) params = params.set('page_size', p.page_size);
    if (p.q != null) params = params.set('q', p.q.trim());
    if (p.sort_by != null) params = params.set('sort_by', p.sort_by);
    if (p.sort_order != null) params = params.set('sort_order', p.sort_order);
    if (p.scope != null) params = params.set('scope', p.scope);
    return this.http.get<MetadataNameListResponse>(`${this.base}${endpoint}`, { params });
  }
}

function normalizeMetadataQuery(value: string): string {
  return normalizeMetadataNameForSubmission(value) || value.trim();
}

function encodeMetadataPathSegment(value: string): string {
  return encodeURIComponent(value.trim()).replace(/'/g, '%27');
}
