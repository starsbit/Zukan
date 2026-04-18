import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BatchesClientService } from './batches-client.service';
import { API_BASE_URL } from './api.config';

const mockBatchPage = { total: 0, next_cursor: null, has_more: false, page_size: 20, items: [] };
const mockBatch = {
  id: 'b1', user_id: 'u1', type: 'upload' as const, status: 'done' as const,
  total_items: 2, queued_items: 0, processing_items: 0, done_items: 2, failed_items: 0,
  created_at: '2026-01-01T00:00:00Z', started_at: null, finished_at: null,
  last_heartbeat_at: null, app_version: null, worker_version: null, error_summary: null,
};
const mockItemPage = { total: 0, next_cursor: null, has_more: false, page_size: 50, items: [] };
const mockReviewPage = { total: 1, items: [], recommendation_groups: [] };
const mockReviewSummary = {
  unresolved_count: 2,
  review_batch_ids: ['b1'],
  latest_batch_id: 'b1',
  latest_batch_created_at: '2026-01-01T00:00:00Z',
};

describe('BatchesClientService', () => {
  let service: BatchesClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(BatchesClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list sends GET /api/v1/me/import-batches', () => {
    service.list().subscribe(res => expect(res).toEqual(mockBatchPage));

    const req = http.expectOne('/api/v1/me/import-batches');
    expect(req.request.method).toBe('GET');
    req.flush(mockBatchPage);
  });

  it('list passes pagination params', () => {
    service.list({ after: 'cursor123', page_size: 10 }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/me/import-batches');
    expect(req.request.params.get('after')).toBe('cursor123');
    expect(req.request.params.get('page_size')).toBe('10');
    req.flush(mockBatchPage);
  });

  it('get sends GET /api/v1/me/import-batches/{id}', () => {
    service.get('b1').subscribe(res => expect(res).toEqual(mockBatch));

    const req = http.expectOne('/api/v1/me/import-batches/b1');
    expect(req.request.method).toBe('GET');
    req.flush(mockBatch);
  });

  it('listItems sends GET /api/v1/me/import-batches/{id}/items', () => {
    service.listItems('b1').subscribe(res => expect(res).toEqual(mockItemPage));

    const req = http.expectOne('/api/v1/me/import-batches/b1/items');
    expect(req.request.method).toBe('GET');
    req.flush(mockItemPage);
  });

  it('listItems passes pagination params', () => {
    service.listItems('b1', { page_size: 50 }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/me/import-batches/b1/items');
    expect(req.request.params.get('page_size')).toBe('50');
    req.flush(mockItemPage);
  });

  it('listReviewItems sends GET /api/v1/me/import-batches/{id}/review-items', () => {
    service.listReviewItems('b1').subscribe(res => expect(res).toEqual(mockReviewPage));

    const req = http.expectOne('/api/v1/me/import-batches/b1/review-items');
    expect(req.request.method).toBe('GET');
    req.flush(mockReviewPage);
  });

  it('listReviewItems passes include_recommendations', () => {
    service.listReviewItems('b1', { include_recommendations: true }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/me/import-batches/b1/review-items');
    expect(req.request.params.get('include_recommendations')).toBe('true');
    req.flush(mockReviewPage);
  });

  it('listAllReviewItems sends GET /api/v1/me/import-batches/review-items', () => {
    service.listAllReviewItems().subscribe(res => expect(res).toEqual(mockReviewPage));

    const req = http.expectOne('/api/v1/me/import-batches/review-items');
    expect(req.request.method).toBe('GET');
    req.flush(mockReviewPage);
  });

  it('listAllReviewItems passes include_recommendations', () => {
    service.listAllReviewItems({ include_recommendations: true }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/me/import-batches/review-items');
    expect(req.request.params.get('include_recommendations')).toBe('true');
    req.flush(mockReviewPage);
  });

  it('listReviewSummary sends GET /api/v1/me/import-batches/review-summary', () => {
    service.listReviewSummary().subscribe(res => expect(res).toEqual(mockReviewSummary));

    const req = http.expectOne('/api/v1/me/import-batches/review-summary');
    expect(req.request.method).toBe('GET');
    req.flush(mockReviewSummary);
  });
});
