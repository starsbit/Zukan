import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  ImportBatchItemListResponse,
  ImportBatchRead,
  ImportBatchListResponse,
  ListImportBatchItemsQuery,
  ListImportBatchesQuery,
  Uuid
} from '../../models/api';
import { ClientApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class BatchesClientService {
  private readonly api = inject(ClientApiService);

  list(query?: ListImportBatchesQuery): Observable<ImportBatchListResponse> {
    return this.api.get<ImportBatchListResponse>('/me/import-batches', { query });
  }

  get(batchId: Uuid): Observable<ImportBatchRead> {
    return this.api.get<ImportBatchRead>(`/me/import-batches/${batchId}`);
  }

  listItems(batchId: Uuid, query?: ListImportBatchItemsQuery): Observable<ImportBatchItemListResponse> {
    return this.api.get<ImportBatchItemListResponse>(`/me/import-batches/${batchId}/items`, { query });
  }
}
