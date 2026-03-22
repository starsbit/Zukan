import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ListTagsQuery, TagManagementResult, TagRead } from '../../models/api';
import { ClientApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class TagsClientService {
  private readonly api = inject(ClientApiService);

  list(query?: ListTagsQuery): Observable<TagRead[]> {
    return this.api.get<TagRead[]>('/tags', { query });
  }

  deleteTag(tagName: string): Observable<TagManagementResult> {
    return this.api.delete<TagManagementResult>(`/tags/${encodePathSegment(tagName)}`);
  }

  trashMediaByTag(tagName: string): Observable<TagManagementResult> {
    return this.api.post<TagManagementResult>(`/tags/${encodePathSegment(tagName)}/trash-media`, {});
  }

  deleteCharacterName(characterName: string): Observable<TagManagementResult> {
    return this.api.delete<TagManagementResult>(`/character-names/${encodePathSegment(characterName)}`);
  }

  trashMediaByCharacterName(characterName: string): Observable<TagManagementResult> {
    return this.api.post<TagManagementResult>(`/character-names/${encodePathSegment(characterName)}/trash-media`, {});
  }
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}
