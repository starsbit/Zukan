import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ListTagsQuery, TagListResponse, TagManagementResult } from '../../models/api';
import { ClientApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class TagsClientService {
  private readonly api = inject(ClientApiService);

  list(query?: ListTagsQuery): Observable<TagListResponse> {
    return this.api.get<TagListResponse>('/tags', { query });
  }

  removeTagFromMedia(tagName: string): Observable<TagManagementResult> {
    return this.api.post<TagManagementResult>(`/tags/${encodePathSegment(tagName)}/actions/remove-from-media`, {});
  }

  trashMediaByTag(tagName: string): Observable<TagManagementResult> {
    return this.api.post<TagManagementResult>(`/tags/${encodePathSegment(tagName)}/actions/trash-media`, {});
  }

  removeCharacterNameFromMedia(characterName: string): Observable<TagManagementResult> {
    return this.api.post<TagManagementResult>(`/character-names/${encodePathSegment(characterName)}/actions/remove-from-media`, {});
  }

  trashMediaByCharacterName(characterName: string): Observable<TagManagementResult> {
    return this.api.post<TagManagementResult>(`/character-names/${encodePathSegment(characterName)}/actions/trash-media`, {});
  }
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}
