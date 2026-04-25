import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CharacterGraphResponse,
  CharacterGraphSearchResult,
  GraphSeriesMode,
} from '../../models/character-graph';
import { API_BASE_URL } from './api.config';

export interface CharacterGraphParams {
  center_entity_id?: string;
  center_name?: string;
  limit?: number;
  min_similarity?: number;
  series_mode?: GraphSeriesMode;
  sample_size?: number;
}

@Injectable({ providedIn: 'root' })
export class CharacterGraphClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  searchCharacters(q: string, limit = 20): Observable<CharacterGraphSearchResult[]> {
    const params = new HttpParams()
      .set('q', q.trim())
      .set('limit', limit);
    return this.http.get<CharacterGraphSearchResult[]>(
      `${this.base}/api/v1/graphs/characters/search`,
      { params },
    );
  }

  getCharacterGraph(params: CharacterGraphParams = {}): Observable<CharacterGraphResponse> {
    let httpParams = new HttpParams();
    if (params.center_entity_id != null) httpParams = httpParams.set('center_entity_id', params.center_entity_id);
    if (params.center_name != null) httpParams = httpParams.set('center_name', params.center_name);
    if (params.limit != null) httpParams = httpParams.set('limit', params.limit);
    if (params.min_similarity != null) httpParams = httpParams.set('min_similarity', params.min_similarity);
    if (params.series_mode != null) httpParams = httpParams.set('series_mode', params.series_mode);
    if (params.sample_size != null) httpParams = httpParams.set('sample_size', params.sample_size);
    return this.http.get<CharacterGraphResponse>(`${this.base}/api/v1/graphs/characters`, {
      params: httpParams,
    });
  }
}
