import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CollectionDiscardResponse,
  CollectionItemRead,
  CollectionItemUpdate,
  CollectionListParams,
  CollectionListResponse,
  CollectionOwnerListParams,
  CollectionOwnerListResponse,
  CollectionPrivacyRead,
  CollectionPrivacyUpdate,
  CollectionStatsResponse,
} from '../../models/collection';
import { API_BASE_URL } from './api.config';

@Injectable({ providedIn: 'root' })
export class CollectionClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  list(params: CollectionListParams = {}): Observable<CollectionListResponse> {
    return this.http.get<CollectionListResponse>(`${this.base}/api/v1/collection`, {
      params: this.toParams(params),
    });
  }

  getItem(id: string): Observable<CollectionItemRead> {
    return this.http.get<CollectionItemRead>(`${this.base}/api/v1/collection/items/${id}`);
  }

  updateItem(id: string, body: CollectionItemUpdate): Observable<CollectionItemRead> {
    return this.http.patch<CollectionItemRead>(`${this.base}/api/v1/collection/items/${id}`, body);
  }

  upgradeItem(id: string): Observable<CollectionItemRead> {
    return this.http.post<CollectionItemRead>(`${this.base}/api/v1/collection/items/${id}/upgrade`, {});
  }

  discardItem(id: string): Observable<CollectionDiscardResponse> {
    return this.http.post<CollectionDiscardResponse>(`${this.base}/api/v1/collection/items/${id}/discard`, {});
  }

  listUser(userId: string, params: CollectionListParams = {}): Observable<CollectionListResponse> {
    return this.http.get<CollectionListResponse>(`${this.base}/api/v1/users/${userId}/collection`, {
      params: this.toParams(params),
    });
  }

  getUserStats(userId: string): Observable<CollectionStatsResponse> {
    return this.http.get<CollectionStatsResponse>(`${this.base}/api/v1/users/${userId}/collection/stats`);
  }

  listPublicOwners(params: CollectionOwnerListParams = {}): Observable<CollectionOwnerListResponse> {
    let httpParams = new HttpParams();
    if (params.q != null) httpParams = httpParams.set('q', params.q);
    if (params.tradeable_only != null) httpParams = httpParams.set('tradeable_only', params.tradeable_only);
    return this.http.get<CollectionOwnerListResponse>(`${this.base}/api/v1/users/collections`, {
      params: httpParams,
    });
  }

  getPrivacy(): Observable<CollectionPrivacyRead> {
    return this.http.get<CollectionPrivacyRead>(`${this.base}/api/v1/users/me/collection-privacy`);
  }

  updatePrivacy(body: CollectionPrivacyUpdate): Observable<CollectionPrivacyRead> {
    return this.http.patch<CollectionPrivacyRead>(`${this.base}/api/v1/users/me/collection-privacy`, body);
  }

  private toParams(p: CollectionListParams): HttpParams {
    let params = new HttpParams();
    if (p.rarity_tier != null) params = params.set('rarity_tier', p.rarity_tier);
    for (const tag of p.tags ?? []) params = params.append('tags', tag);
    if (p.character_name != null) params = params.set('character_name', p.character_name);
    if (p.series_name != null) params = params.set('series_name', p.series_name);
    for (const name of p.character_names ?? []) params = params.append('character_names', name);
    for (const name of p.series_names ?? []) params = params.append('series_names', name);
    if (p.level != null) params = params.set('level', p.level);
    if (p.tradeable != null) params = params.set('tradeable', p.tradeable);
    if (p.duplicates_only != null) params = params.set('duplicates_only', p.duplicates_only);
    return params;
  }
}
