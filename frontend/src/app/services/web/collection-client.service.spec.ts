import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CollectionVisibility } from '../../models/collection';
import { RarityTier } from '../../models/gacha';
import { API_BASE_URL } from './api.config';
import { CollectionClientService } from './collection-client.service';

const collectionItem = {
  id: 'ci1',
  user_id: 'u1',
  media_id: 'm1',
  rarity_tier_at_acquisition: RarityTier.SR,
  level: 2,
  upgrade_xp: 4,
  copies_pulled: 3,
  locked: false,
  tradeable: true,
  acquired_at: '2026-04-28T00:00:00Z',
  updated_at: '2026-04-28T00:00:00Z',
  media: { id: 'm1', filename: 'saber.webp', is_nsfw: false, is_sensitive: false },
};

describe('CollectionClientService', () => {
  let service: CollectionClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(CollectionClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list sends GET /api/v1/collection with filters', () => {
    const response = { total: 1, items: [collectionItem] };

    service.list({
      rarity_tier: RarityTier.SR,
      character_name: 'Saber',
      series_name: 'Fate',
      level: 2,
      tradeable: true,
      duplicates_only: true,
    }).subscribe(res => expect(res).toEqual(response));

    const req = http.expectOne(r => r.url === '/api/v1/collection');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('rarity_tier')).toBe('SR');
    expect(req.request.params.get('character_name')).toBe('Saber');
    expect(req.request.params.get('series_name')).toBe('Fate');
    expect(req.request.params.get('level')).toBe('2');
    expect(req.request.params.get('tradeable')).toBe('true');
    expect(req.request.params.get('duplicates_only')).toBe('true');
    req.flush(response);
  });

  it('getItem sends GET /api/v1/collection/items/{id}', () => {
    service.getItem('ci1').subscribe(res => expect(res).toEqual(collectionItem));

    const req = http.expectOne('/api/v1/collection/items/ci1');
    expect(req.request.method).toBe('GET');
    req.flush(collectionItem);
  });

  it('updateItem sends PATCH /api/v1/collection/items/{id}', () => {
    const body = { locked: true };

    service.updateItem('ci1', body).subscribe(res => expect(res).toEqual(collectionItem));

    const req = http.expectOne('/api/v1/collection/items/ci1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(body);
    req.flush(collectionItem);
  });

  it('upgradeItem sends POST /api/v1/collection/items/{id}/upgrade', () => {
    service.upgradeItem('ci1').subscribe(res => expect(res).toEqual(collectionItem));

    const req = http.expectOne('/api/v1/collection/items/ci1/upgrade');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(collectionItem);
  });

  it('listUser sends GET /api/v1/users/{userId}/collection', () => {
    const response = { total: 1, items: [collectionItem] };

    service.listUser('u2', { duplicates_only: true }).subscribe(res => expect(res).toEqual(response));

    const req = http.expectOne(r => r.url === '/api/v1/users/u2/collection');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('duplicates_only')).toBe('true');
    req.flush(response);
  });

  it('getUserStats sends GET /api/v1/users/{userId}/collection/stats', () => {
    const response = {
      total_items: 1,
      total_copies_pulled: 3,
      duplicate_copies: 2,
      max_level_items: 0,
      tier_counts: { SR: 1 },
    };

    service.getUserStats('u2').subscribe(res => expect(res).toEqual(response));

    const req = http.expectOne('/api/v1/users/u2/collection/stats');
    expect(req.request.method).toBe('GET');
    req.flush(response);
  });

  it('getPrivacy sends GET /api/v1/users/me/collection-privacy', () => {
    const response = {
      user_id: 'u1',
      visibility: CollectionVisibility.PUBLIC,
      allow_trade_requests: true,
      show_stats: true,
      show_nsfw: false,
    };

    service.getPrivacy().subscribe(res => expect(res).toEqual(response));

    const req = http.expectOne('/api/v1/users/me/collection-privacy');
    expect(req.request.method).toBe('GET');
    req.flush(response);
  });

  it('updatePrivacy sends PATCH /api/v1/users/me/collection-privacy', () => {
    const body = { visibility: CollectionVisibility.PUBLIC };
    const response = {
      user_id: 'u1',
      visibility: CollectionVisibility.PUBLIC,
      allow_trade_requests: true,
      show_stats: true,
      show_nsfw: false,
    };

    service.updatePrivacy(body).subscribe(res => expect(res).toEqual(response));

    const req = http.expectOne('/api/v1/users/me/collection-privacy');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(body);
    req.flush(response);
  });
});
