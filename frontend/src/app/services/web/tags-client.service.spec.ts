import '@angular/compiler';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TagsClientService } from './tags-client.service';
import { API_BASE_URL } from './api.config';

const mockTagPage = { total: 0, next_cursor: null, has_more: false, page_size: 100, items: [] };
const mockNamePage = { total: 0, next_cursor: null, has_more: false, page_size: 100, items: [] };
const mockResult = {
  matched_media: 3,
  updated_media: 3,
  trashed_media: 0,
  already_trashed: 0,
  deleted_tag: false,
  deleted_source: false,
};

describe('TagsClientService', () => {
  let service: TagsClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(TagsClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list sends GET /api/v1/tags', () => {
    service.list().subscribe(res => expect(res).toEqual(mockTagPage));

    const req = http.expectOne('/api/v1/tags');
    expect(req.request.method).toBe('GET');
    req.flush(mockTagPage);
  });

  it('list passes q and owner scope params', () => {
    service.list({ q: 'Saber Alter', scope: 'owner' }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/tags');
    expect(req.request.params.get('q')).toBe('saber_alter');
    expect(req.request.params.get('scope')).toBe('owner');
    req.flush(mockTagPage);
  });

  it('listCharacterNames sends GET to character name list endpoint', () => {
    service.listCharacterNames({ q: 'Saber Alter', scope: 'owner' }).subscribe(res => expect(res).toEqual(mockNamePage));

    const req = http.expectOne(r => r.url === '/api/v1/character-names');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('saber_alter');
    expect(req.request.params.get('scope')).toBe('owner');
    req.flush(mockNamePage);
  });

  it('listSeriesNames sends GET to series name list endpoint', () => {
    service.listSeriesNames({ q: 'Fate Stay Night', scope: 'owner' }).subscribe(res => expect(res).toEqual(mockNamePage));

    const req = http.expectOne(r => r.url === '/api/v1/series-names');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('fate_stay_night');
    expect(req.request.params.get('scope')).toBe('owner');
    req.flush(mockNamePage);
  });

  it('removeFromMedia sends POST to tag action endpoint', () => {
    service.removeFromMedia(42).subscribe(res => expect(res).toEqual(mockResult));

    const req = http.expectOne('/api/v1/tags/42/actions/remove-from-media');
    expect(req.request.method).toBe('POST');
    req.flush(mockResult);
  });

  it('trashMedia sends POST to tag trash action endpoint', () => {
    service.trashMedia(42).subscribe(res => expect(res).toEqual(mockResult));

    const req = http.expectOne('/api/v1/tags/42/actions/trash-media');
    expect(req.request.method).toBe('POST');
    req.flush(mockResult);
  });

  it('merge sends POST to tag merge action endpoint', () => {
    service.merge(42, 84).subscribe(res => expect(res).toEqual(mockResult));

    const req = http.expectOne('/api/v1/tags/42/actions/merge');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ target_tag_id: 84 });
    req.flush(mockResult);
  });

  it('removeCharacterFromMedia encodes character name in URL', () => {
    service.removeCharacterFromMedia('Saber Alter').subscribe(res => expect(res).toEqual(mockResult));

    const req = http.expectOne('/api/v1/character-names/saber_alter/actions/remove-from-media');
    expect(req.request.method).toBe('POST');
    req.flush(mockResult);
  });

  it('trashMediaByCharacter sends POST to character trash action', () => {
    service.trashMediaByCharacter('Rin').subscribe(res => expect(res).toEqual(mockResult));

    const req = http.expectOne('/api/v1/character-names/Rin/actions/trash-media');
    expect(req.request.method).toBe('POST');
    req.flush(mockResult);
  });

  it('mergeCharacterName sends POST to character merge action', () => {
    service.mergeCharacterName('Saber Alter', 'Artoria Pendragon').subscribe(res => expect(res).toEqual(mockResult));

    const req = http.expectOne('/api/v1/character-names/saber_alter/actions/merge');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ target_name: 'artoria_pendragon' });
    req.flush(mockResult);
  });

  it('removeSeriesFromMedia encodes series name in URL', () => {
    service.removeSeriesFromMedia('Fate stay night').subscribe(res => expect(res).toEqual(mockResult));

    const req = http.expectOne('/api/v1/series-names/fate_stay_night/actions/remove-from-media');
    expect(req.request.method).toBe('POST');
    req.flush(mockResult);
  });

  it('mergeSeriesName sends POST to series merge action', () => {
    service.mergeSeriesName('Fate Zero', 'Fate stay night').subscribe(res => expect(res).toEqual(mockResult));

    const req = http.expectOne('/api/v1/series-names/fate_zero/actions/merge');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ target_name: 'fate_stay_night' });
    req.flush(mockResult);
  });
});
