import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { TradeCreateRequest, TradeListResponse, TradeOfferRead } from '../../models/trade';
import { API_BASE_URL } from './api.config';

@Injectable({ providedIn: 'root' })
export class TradesClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  create(body: TradeCreateRequest): Observable<TradeOfferRead> {
    return this.http.post<TradeOfferRead>(`${this.base}/api/v1/trades`, body);
  }

  incoming(): Observable<TradeListResponse> {
    return this.http.get<TradeListResponse>(`${this.base}/api/v1/trades/incoming`);
  }

  outgoing(): Observable<TradeListResponse> {
    return this.http.get<TradeListResponse>(`${this.base}/api/v1/trades/outgoing`);
  }

  accept(id: string): Observable<TradeOfferRead> {
    return this.http.post<TradeOfferRead>(`${this.base}/api/v1/trades/${id}/accept`, {});
  }

  reject(id: string): Observable<TradeOfferRead> {
    return this.http.post<TradeOfferRead>(`${this.base}/api/v1/trades/${id}/reject`, {});
  }

  cancel(id: string): Observable<TradeOfferRead> {
    return this.http.post<TradeOfferRead>(`${this.base}/api/v1/trades/${id}/cancel`, {});
  }
}
