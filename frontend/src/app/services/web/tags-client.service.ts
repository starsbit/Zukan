import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { TagListResponse, TagManagementResult } from '../../models/tags';

export interface TagListParams {
  after?: string;
  page_size?: number;
  category?: number;
  q?: string;
  sort_by?: 'name' | 'media_count';
  sort_order?: 'asc' | 'desc';
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
    if (p.q != null) params = params.set('q', p.q);
    if (p.sort_by != null) params = params.set('sort_by', p.sort_by);
    if (p.sort_order != null) params = params.set('sort_order', p.sort_order);
    return this.http.get<TagListResponse>(`${this.base}/api/v1/tags`, { params });
  }

  removeFromMedia(tagId: number): Observable<TagManagementResult> {
    return this.http.post<TagManagementResult>(
      `${this.base}/api/v1/tags/${tagId}/actions/remove-from-media`,
      null,
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
      `${this.base}/api/v1/character-names/${encodeURIComponent(characterName)}/actions/remove-from-media`,
      null,
    );
  }

  trashMediaByCharacter(characterName: string): Observable<TagManagementResult> {
    return this.http.post<TagManagementResult>(
      `${this.base}/api/v1/character-names/${encodeURIComponent(characterName)}/actions/trash-media`,
      null,
    );
  }
}
