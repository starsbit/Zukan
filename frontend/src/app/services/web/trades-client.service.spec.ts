import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TradeStatus } from '../../models/trade';
import { API_BASE_URL } from './api.config';
import { TradesClientService } from './trades-client.service';

const trade = {
  id: 't1',
  sender_user_id: 'u1',
  receiver_user_id: 'u2',
  status: TradeStatus.PENDING,
  message: 'Want to trade?',
  created_at: '2026-04-28T00:00:00Z',
  updated_at: '2026-04-28T00:00:00Z',
  expires_at: null,
  items: [],
};

describe('TradesClientService', () => {
  let service: TradesClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(TradesClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('create sends POST /api/v1/trades with body', () => {
    const body = {
      receiver_user_id: 'u2',
      offered_item_ids: ['ci1'],
      requested_item_ids: ['ci2'],
      message: 'Want to trade?',
    };

    service.create(body).subscribe(res => expect(res).toEqual(trade));

    const req = http.expectOne('/api/v1/trades');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush(trade);
  });

  it('incoming sends GET /api/v1/trades/incoming', () => {
    const response = { total: 1, items: [trade] };

    service.incoming().subscribe(res => expect(res).toEqual(response));

    const req = http.expectOne('/api/v1/trades/incoming');
    expect(req.request.method).toBe('GET');
    req.flush(response);
  });

  it('outgoing sends GET /api/v1/trades/outgoing', () => {
    const response = { total: 1, items: [trade] };

    service.outgoing().subscribe(res => expect(res).toEqual(response));

    const req = http.expectOne('/api/v1/trades/outgoing');
    expect(req.request.method).toBe('GET');
    req.flush(response);
  });

  it('accept sends POST /api/v1/trades/{id}/accept', () => {
    const accepted = { ...trade, status: TradeStatus.ACCEPTED };

    service.accept('t1').subscribe(res => expect(res).toEqual(accepted));

    const req = http.expectOne('/api/v1/trades/t1/accept');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(accepted);
  });

  it('reject sends POST /api/v1/trades/{id}/reject', () => {
    const rejected = { ...trade, status: TradeStatus.REJECTED };

    service.reject('t1').subscribe(res => expect(res).toEqual(rejected));

    const req = http.expectOne('/api/v1/trades/t1/reject');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(rejected);
  });

  it('cancel sends POST /api/v1/trades/{id}/cancel', () => {
    const cancelled = { ...trade, status: TradeStatus.CANCELLED };

    service.cancel('t1').subscribe(res => expect(res).toEqual(cancelled));

    const req = http.expectOne('/api/v1/trades/t1/cancel');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(cancelled);
  });
});
