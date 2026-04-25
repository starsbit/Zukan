import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_URL } from './api.config';
import { CharacterGraphClientService } from './character-graph-client.service';

describe('CharacterGraphClientService', () => {
  let service: CharacterGraphClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(CharacterGraphClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('searchCharacters sends owner graph autocomplete request', () => {
    service.searchCharacters('Saber', 8).subscribe((result) => {
      expect(result).toEqual([{ id: 'c1', name: 'Saber', media_count: 12 }]);
    });

    const req = http.expectOne((request) => request.url === '/api/v1/graphs/characters/search');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('Saber');
    expect(req.request.params.get('limit')).toBe('8');
    req.flush([{ id: 'c1', name: 'Saber', media_count: 12 }]);
  });

  it('getCharacterGraph forwards graph filters', () => {
    service.getCharacterGraph({
      center_entity_id: 'c1',
      limit: 40,
      min_similarity: 0.82,
      series_mode: 'different',
      sample_size: 4,
    }).subscribe((result) => {
      expect(result.nodes).toEqual([]);
    });

    const req = http.expectOne((request) => request.url === '/api/v1/graphs/characters');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('center_entity_id')).toBe('c1');
    expect(req.request.params.get('limit')).toBe('40');
    expect(req.request.params.get('min_similarity')).toBe('0.82');
    expect(req.request.params.get('series_mode')).toBe('different');
    expect(req.request.params.get('sample_size')).toBe('4');
    req.flush({
      model_version: 'clip_onnx_v1',
      total_characters_considered: 0,
      center_entity_id: null,
      nodes: [],
      edges: [],
    });
  });
});
