import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GachaPullMode, RarityTier } from '../../models/gacha';
import { API_BASE_URL } from './api.config';
import { GachaClientService } from './gacha-client.service';

describe('GachaClientService', () => {
  let service: GachaClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(GachaClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('pull sends POST /api/v1/gacha/pull with body', () => {
    const body = { mode: GachaPullMode.TEN_PULL, pool: 'default' };
    const response = {
      id: 'p1',
      user_id: 'u1',
      mode: GachaPullMode.TEN_PULL,
      pool: 'default',
      currency_spent: 1200,
      currency_balance: 4800,
      created_at: '2026-04-28T00:00:00Z',
      items: [
        {
          id: 'pi1',
          media_id: 'm1',
          rarity_tier: RarityTier.R,
          rarity_score: 0.6,
          was_duplicate: false,
          upgrade_material_granted: 0,
          position: 0,
          collection_item_id: 'ci1',
        },
      ],
    };

    service.pull(body).subscribe(res => expect(res).toEqual(response));

    const req = http.expectOne('/api/v1/gacha/pull');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush(response);
  });

  it('getBalance sends GET /api/v1/gacha/balance', () => {
    const response = {
      user_id: 'u1',
      balance: 6000,
      total_claimed: 6000,
      total_spent: 0,
      last_daily_claimed_on: '2026-04-28',
      daily_claim_amount: 6000,
      daily_claim_available: false,
      next_daily_claim_at: '2026-04-29T00:00:00Z',
    };

    service.getBalance().subscribe(res => expect(res).toEqual(response));

    const req = http.expectOne('/api/v1/gacha/balance');
    expect(req.request.method).toBe('GET');
    req.flush(response);
  });

  it('claimDaily sends POST /api/v1/gacha/daily-claim', () => {
    const response = {
      claimed: 6000,
      balance: 6000,
      daily_claim_available: false,
      next_daily_claim_at: '2026-04-29T00:00:00Z',
    };

    service.claimDaily().subscribe(res => expect(res).toEqual(response));

    const req = http.expectOne('/api/v1/gacha/daily-claim');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(response);
  });

  it('getStats sends GET /api/v1/gacha/stats', () => {
    const response = {
      total_rarity_snapshots: 20,
      tier_counts: { N: 10, R: 5 },
      collection_count: 3,
      duplicate_copies: 1,
      currency_balance: 7,
      daily_claim_available: true,
      next_daily_claim_at: null,
    };

    service.getStats().subscribe(res => expect(res).toEqual(response));

    const req = http.expectOne('/api/v1/gacha/stats');
    expect(req.request.method).toBe('GET');
    req.flush(response);
  });

  it('recalculateRarity sends POST /api/v1/gacha/recalculate-rarity', () => {
    const response = { recalculated: 20, score_version: 'v1', tier_counts: { N: 11, R: 4 } };

    service.recalculateRarity().subscribe(res => expect(res).toEqual(response));

    const req = http.expectOne('/api/v1/gacha/recalculate-rarity');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(response);
  });
});
