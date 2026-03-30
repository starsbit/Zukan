import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TagsClientService } from './tags-client.service';
import { API_BASE_URL } from './api.config';

const mockTagPage = { total: 0, next_cursor: null, has_more: false, page_size: 100, items: [] };
const mockResult = { matched_media: 3, updated_media: 3, trashed_media: 0, already_trashed: 0, deleted_tag: false };

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

  it('list passes category and q params', () => {
    service.list({ category: 4, q: 'saber' }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/tags');
    expect(req.request.params.get('category')).toBe('4');
    expect(req.request.params.get('q')).toBe('saber');
    req.flush(mockTagPage);
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

  it('removeCharacterFromMedia encodes character name in URL', () => {
    service.removeCharacterFromMedia('Saber Alter').subscribe(res => expect(res).toEqual(mockResult));

    const req = http.expectOne('/api/v1/character-names/Saber%20Alter/actions/remove-from-media');
    expect(req.request.method).toBe('POST');
    req.flush(mockResult);
  });

  it('trashMediaByCharacter sends POST to character trash action', () => {
    service.trashMediaByCharacter('Rin').subscribe(res => expect(res).toEqual(mockResult));

    const req = http.expectOne('/api/v1/character-names/Rin/actions/trash-media');
    expect(req.request.method).toBe('POST');
    req.flush(mockResult);
  });
});
