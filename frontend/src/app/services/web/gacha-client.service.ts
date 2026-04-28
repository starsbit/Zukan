import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  GachaCurrencyBalanceRead,
  GachaDailyClaimResponse,
  GachaPullRead,
  GachaPullRequest,
  GachaStatsResponse,
  RarityRecalculationResponse,
} from '../../models/gacha';
import { API_BASE_URL } from './api.config';

@Injectable({ providedIn: 'root' })
export class GachaClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  pull(body: GachaPullRequest = {}): Observable<GachaPullRead> {
    return this.http.post<GachaPullRead>(`${this.base}/api/v1/gacha/pull`, body);
  }

  getBalance(): Observable<GachaCurrencyBalanceRead> {
    return this.http.get<GachaCurrencyBalanceRead>(`${this.base}/api/v1/gacha/balance`);
  }

  claimDaily(): Observable<GachaDailyClaimResponse> {
    return this.http.post<GachaDailyClaimResponse>(`${this.base}/api/v1/gacha/daily-claim`, {});
  }

  getStats(): Observable<GachaStatsResponse> {
    return this.http.get<GachaStatsResponse>(`${this.base}/api/v1/gacha/stats`);
  }

  recalculateRarity(): Observable<RarityRecalculationResponse> {
    return this.http.post<RarityRecalculationResponse>(`${this.base}/api/v1/gacha/recalculate-rarity`, {});
  }
}
