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

  removeTagFromMedia(tagId: number): Observable<TagManagementResult> {
    return this.api.post<TagManagementResult>(`/tags/${tagId}/actions/remove-from-media`, {});
  }

  trashMediaByTag(tagId: number): Observable<TagManagementResult> {
    return this.api.post<TagManagementResult>(`/tags/${tagId}/actions/trash-media`, {});
  }

  removeCharacterNameFromMedia(characterName: string): Observable<TagManagementResult> {
    return this.api.post<TagManagementResult>(`/character-names/${encodeURIComponent(characterName)}/actions/remove-from-media`, {});
  }

  trashMediaByCharacterName(characterName: string): Observable<TagManagementResult> {
    return this.api.post<TagManagementResult>(`/character-names/${encodeURIComponent(characterName)}/actions/trash-media`, {});
  }
}
