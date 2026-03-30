import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import {
  ImportBatchItemListResponse,
  ImportBatchListResponse,
  ImportBatchRead,
} from '../../models/processing';

export interface BatchListParams {
  after?: string;
  page_size?: number;
}

export interface BatchItemListParams {
  after?: string;
  page_size?: number;
}

@Injectable({ providedIn: 'root' })
export class BatchesClientService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  list(p: BatchListParams = {}): Observable<ImportBatchListResponse> {
    let params = new HttpParams();
    if (p.after != null) params = params.set('after', p.after);
    if (p.page_size != null) params = params.set('page_size', p.page_size);
    return this.http.get<ImportBatchListResponse>(`${this.base}/api/v1/me/import-batches`, {
      params,
    });
  }

  get(batchId: string): Observable<ImportBatchRead> {
    return this.http.get<ImportBatchRead>(`${this.base}/api/v1/me/import-batches/${batchId}`);
  }

  listItems(batchId: string, p: BatchItemListParams = {}): Observable<ImportBatchItemListResponse> {
    let params = new HttpParams();
    if (p.after != null) params = params.set('after', p.after);
    if (p.page_size != null) params = params.set('page_size', p.page_size);
    return this.http.get<ImportBatchItemListResponse>(
      `${this.base}/api/v1/me/import-batches/${batchId}/items`,
      { params },
    );
  }
}
