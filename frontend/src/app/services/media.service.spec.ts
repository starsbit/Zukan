import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MediaService } from './media.service';
import { API_BASE_URL } from './web/api.config';
import { MediaType, TaggingStatus, ProcessingStatus, MediaVisibility } from '../models/media';

function makeMedia(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    uploader_id: 'u1',
    uploader_username: 'uploader',
    owner_id: 'u1',
    owner_username: 'owner',
    visibility: MediaVisibility.PRIVATE,
    filename: `${id}.jpg`,
    original_filename: `${id}.jpg`,
    media_type: MediaType.IMAGE,
    metadata: {
      file_size: 1024, width: 100, height: 100,
      duration_seconds: null, frame_count: null,
      mime_type: 'image/jpeg', captured_at: '2026-01-01T00:00:00Z',
    },
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    tags: [],
    ocr_text_override: null,
    is_nsfw: false,
    tagging_status: TaggingStatus.DONE,
    tagging_error: null,
    thumbnail_status: ProcessingStatus.DONE,
    poster_status: ProcessingStatus.NOT_APPLICABLE,
    ocr_text: null,
    is_favorited: false,
    favorite_count: 0,
    ...overrides,
  };
}

function makePage(items: ReturnType<typeof makeMedia>[], has_more = false, next_cursor: string | null = null) {
  return { items, has_more, next_cursor, total: items.length, page_size: 20 };
}

describe('MediaService', () => {
  let service: MediaService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(MediaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('load()', () => {
    it('sets items and pagination signals from response', () => {
      const page = makePage([makeMedia('m1'), makeMedia('m2')], true, 'cursor1');
      page.total = 10;

      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(page);

      expect(service.items()).toHaveLength(2);
      expect(service.items()[0].id).toBe('m1');
      expect(service.hasMore()).toBe(true);
      expect(service.total()).toBe(10);
      expect(service.loading()).toBe(false);
    });

    it('replaces items on subsequent load()', () => {
      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1')]));

      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m2')]));

      expect(service.items()).toHaveLength(1);
      expect(service.items()[0].id).toBe('m2');
    });

    it('passes search params to the client', () => {
      service.load({ tag: ['cat', 'night'], nsfw: 'include' as any, visibility: MediaVisibility.PUBLIC }).subscribe();
      const req = http.expectOne(r => r.url === '/api/v1/media/search');
      expect(req.request.params.getAll('tag')).toEqual(['cat', 'night']);
      expect(req.request.params.get('nsfw')).toBe('include');
      expect(req.request.params.get('visibility')).toBe('public');
      req.flush(makePage([]));
    });

    it('sets loading=false and rethrows on error', () => {
      let err: unknown;
      service.load().subscribe({ error: e => (err = e) });
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush('', { status: 500, statusText: 'Server Error' });

      expect(service.loading()).toBe(false);
      expect(err).toBeTruthy();
    });
  });

  describe('loadMore()', () => {
    it('appends items and uses cursor from previous page', () => {
      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush(makePage([makeMedia('m1')], true, 'cur1'));

      service.loadMore().subscribe();
      const req = http.expectOne(r => r.url === '/api/v1/media/search');
      expect(req.request.params.get('after')).toBe('cur1');
      req.flush(makePage([makeMedia('m2')], false, null));

      expect(service.items()).toHaveLength(2);
      expect(service.hasMore()).toBe(false);
    });

    it('returns EMPTY when hasMore is false', () => {
      let emitted = false;
      service.loadMore().subscribe({ next: () => (emitted = true) });
      http.expectNone(r => r.url === '/api/v1/media/search');
      expect(emitted).toBe(false);
    });

    it('returns EMPTY when already loading', () => {
      service.load().subscribe();
      // load is now in-flight, loading=true
      service.loadMore().subscribe();
      // only the original load request should be pending
      const reqs = http.match(r => r.url === '/api/v1/media/search');
      expect(reqs).toHaveLength(1);
      reqs[0].flush(makePage([]));
    });
  });

  describe('reset()', () => {
    it('clears all state', () => {
      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush(makePage([makeMedia('m1')], true, 'c1'));

      service.reset();

      expect(service.items()).toHaveLength(0);
      expect(service.hasMore()).toBe(false);
      expect(service.total()).toBeNull();
      expect(service.loading()).toBe(false);
    });
  });

  describe('update()', () => {
    it('patches the item in the local list', () => {
      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush(makePage([makeMedia('m1'), makeMedia('m2')]));

      const updated = { ...makeMedia('m1'), tags: ['cat'], tag_details: [], external_refs: [], entities: [] };
      service.update('m1', { tags: ['cat'] }).subscribe();
      http.expectOne('/api/v1/media/m1').flush(updated);

      expect(service.items()[0].tags).toEqual(['cat']);
      expect(service.items()[1].id).toBe('m2');
    });
  });

  describe('delete()', () => {
    it('removes the item from the list and decrements total', () => {
      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush({ ...makePage([makeMedia('m1'), makeMedia('m2')]), total: 2 });

      service.delete('m1').subscribe();
      http.expectOne('/api/v1/media/m1').flush(null, { status: 204, statusText: 'No Content' });

      expect(service.items()).toHaveLength(1);
      expect(service.items()[0].id).toBe('m2');
      expect(service.total()).toBe(1);
    });
  });

  describe('restore()', () => {
    it('removes the item from the list', () => {
      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush(makePage([makeMedia('m1')]));

      service.restore('m1').subscribe();
      http.expectOne('/api/v1/media/m1/restore').flush(null, { status: 204, statusText: 'No Content' });

      expect(service.items()).toHaveLength(0);
    });
  });

  describe('purge()', () => {
    it('removes the item from the list', () => {
      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush(makePage([makeMedia('m1')]));

      service.purge('m1').subscribe();
      http.expectOne('/api/v1/media/m1/purge').flush(null, { status: 204, statusText: 'No Content' });

      expect(service.items()).toHaveLength(0);
    });
  });

  describe('batchDelete()', () => {
    it('removes all matched items and adjusts total', () => {
      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush({ ...makePage([makeMedia('m1'), makeMedia('m2'), makeMedia('m3')]), total: 3 });

      service.batchDelete(['m1', 'm3']).subscribe();
      http.expectOne('/api/v1/media/actions/delete').flush({ processed: 2, skipped: 0 });

      expect(service.items()).toHaveLength(1);
      expect(service.items()[0].id).toBe('m2');
      expect(service.total()).toBe(1);
    });
  });

  describe('batchUpdateEntities()', () => {
    it('sends the batch entity payload to the dedicated endpoint', () => {
      service.batchUpdateEntities({ media_ids: ['m1'], character_names: ['Saber'] }).subscribe();

      const req = http.expectOne('/api/v1/media/entities');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ media_ids: ['m1'], character_names: ['Saber'] });
      req.flush({ processed: 1, skipped: 0 });
    });
  });

  describe('batchPurge()', () => {
    it('removes all matched items', () => {
      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush(makePage([makeMedia('m1'), makeMedia('m2')]));

      service.batchPurge(['m1', 'm2']).subscribe();
      http.expectOne('/api/v1/media/actions/purge').flush({ processed: 2, skipped: 0 });

      expect(service.items()).toHaveLength(0);
    });
  });

  describe('batchFavorite()', () => {
    it('updates is_favorited on matched items', () => {
      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush(makePage([makeMedia('m1'), makeMedia('m2'), makeMedia('m3')]));

      service.batchFavorite(['m1', 'm3'], true).subscribe();
      http.expectOne('/api/v1/media').flush({ processed: 2, skipped: 0 });

      expect(service.items()[0].is_favorited).toBe(true);
      expect(service.items()[1].is_favorited).toBe(false);
      expect(service.items()[2].is_favorited).toBe(true);
    });
  });

  describe('batchUpdateVisibility()', () => {
    it('updates visibility on matched items', () => {
      service.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush(makePage([makeMedia('m1'), makeMedia('m2')]));

      service.batchUpdateVisibility(['m1'], MediaVisibility.PUBLIC).subscribe();
      const req = http.expectOne('/api/v1/media');
      expect(req.request.body).toEqual({ media_ids: ['m1'], visibility: MediaVisibility.PUBLIC });
      req.flush({ processed: 1, skipped: 0 });

      expect(service.items()[0].visibility).toBe(MediaVisibility.PUBLIC);
      expect(service.items()[1].visibility).toBe(MediaVisibility.PRIVATE);
    });
  });

  describe('upload()', () => {
    it('sends POST /api/v1/media with FormData', () => {
      const file = new File(['data'], 'test.jpg', { type: 'image/jpeg' });
      const mock = {
        batch_id: 'b1', batch_url: '/batches/b1', batch_items_url: '/batches/b1/items',
        poll_after_seconds: 1, webhooks_supported: false,
        accepted: 1, duplicates: 0, errors: 0, results: [],
      };

      service.upload([file]).subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/media');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toBeInstanceOf(FormData);
      req.flush(mock);
    });

    it('passes visibility through upload params', () => {
      const file = new File(['data'], 'test.jpg', { type: 'image/jpeg' });

      service.upload([file], { visibility: MediaVisibility.PUBLIC }).subscribe();
      const req = http.expectOne('/api/v1/media');

      expect((req.request.body as FormData).get('visibility')).toBe('public');
      req.flush({
        batch_id: 'b1', batch_url: '/batches/b1', batch_items_url: '/batches/b1/items',
        poll_after_seconds: 1, webhooks_supported: false,
        accepted: 1, duplicates: 0, errors: 0, results: [],
      });
    });
  });

  describe('download()', () => {
    it('sends POST /api/v1/media/download and returns blob', () => {
      const blob = new Blob(['data'], { type: 'application/zip' });
      service.download(['m1', 'm2']).subscribe(res => expect(res).toBeInstanceOf(Blob));
      const req = http.expectOne('/api/v1/media/download');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ media_ids: ['m1', 'm2'] });
      req.flush(blob);
    });
  });

  describe('getThumbnailUrl()', () => {
    it('fetches blob and returns object URL', () => {
      const mockUrl = 'blob:http://localhost/thumb1';
      vi.spyOn(URL, 'createObjectURL').mockReturnValue(mockUrl);

      let result: string | undefined;
      service.getThumbnailUrl('m1').subscribe(url => (result = url));
      http.expectOne('/api/v1/media/m1/thumbnail')
        .flush(new Blob(['img'], { type: 'image/jpeg' }));

      expect(result).toBe(mockUrl);
    });

    it('returns cached URL on second call without HTTP request', () => {
      const mockUrl = 'blob:http://localhost/thumb1';
      vi.spyOn(URL, 'createObjectURL').mockReturnValue(mockUrl);

      service.getThumbnailUrl('m1').subscribe();
      http.expectOne('/api/v1/media/m1/thumbnail')
        .flush(new Blob(['img'], { type: 'image/jpeg' }));

      let result: string | undefined;
      service.getThumbnailUrl('m1').subscribe(url => (result = url));
      http.expectNone('/api/v1/media/m1/thumbnail');
      expect(result).toBe(mockUrl);
    });

    it('deduplicates concurrent thumbnail requests for the same media id', () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/thumb1');

      let first: string | undefined;
      let second: string | undefined;

      service.getThumbnailUrl('m1').subscribe((url) => (first = url));
      service.getThumbnailUrl('m1').subscribe((url) => (second = url));

      const requests = http.match('/api/v1/media/m1/thumbnail');
      expect(requests).toHaveLength(1);

      requests[0].flush(new Blob(['img'], { type: 'image/jpeg' }));

      expect(first).toBe('blob:http://localhost/thumb1');
      expect(second).toBe('blob:http://localhost/thumb1');
    });
  });

  describe('getPosterUrl()', () => {
    it('fetches blob and returns object URL', () => {
      const mockUrl = 'blob:http://localhost/poster1';
      vi.spyOn(URL, 'createObjectURL').mockReturnValue(mockUrl);

      let result: string | undefined;
      service.getPosterUrl('m1').subscribe(url => (result = url));
      http.expectOne('/api/v1/media/m1/poster')
        .flush(new Blob(['img'], { type: 'image/jpeg' }));

      expect(result).toBe(mockUrl);
    });
  });

  describe('getFileUrl()', () => {
    it('fetches blob and returns a new object URL each call', () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file-url');

      service.getFileUrl('m1').subscribe();
      http.expectOne('/api/v1/media/m1/file')
        .flush(new Blob(['data'], { type: 'image/jpeg' }));

      service.getFileUrl('m1').subscribe();
      http.expectOne('/api/v1/media/m1/file')
        .flush(new Blob(['data'], { type: 'image/jpeg' }));
    });
  });

  describe('get()', () => {
    it('sends GET /api/v1/media/{id}', () => {
      const detail = { ...makeMedia('m1'), tag_details: [], external_refs: [], entities: [] };
      service.get('m1').subscribe(res => expect(res).toEqual(detail));
      const req = http.expectOne('/api/v1/media/m1');
      expect(req.request.method).toBe('GET');
      req.flush(detail);
    });
  });

  describe('queueTaggingJob()', () => {
    it('sends POST /api/v1/media/{id}/tagging-jobs', () => {
      const mock = { queued: 1 };
      service.queueTaggingJob('m1').subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/media/m1/tagging-jobs');
      expect(req.request.method).toBe('POST');
      req.flush(mock);
    });
  });

  describe('batchQueueTaggingJobs()', () => {
    it('queues tagging through the batch endpoint', () => {
      service.batchQueueTaggingJobs(['m1', 'm2']).subscribe((result) => {
        expect(result).toEqual({ queued: 2 });
      });

      const req = http.expectOne('/api/v1/media/tagging-jobs');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ media_ids: ['m1', 'm2'] });
      req.flush({ queued: 2 });
    });
  });

  describe('getCharacterSuggestions()', () => {
    it('sends GET /api/v1/media/character-suggestions with q', () => {
      const mock = [{ name: 'hatsune_miku', media_count: 5 }];
      service.getCharacterSuggestions('miku').subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne(r => r.url === '/api/v1/media/character-suggestions');
      expect(req.request.params.get('q')).toBe('miku');
      req.flush(mock);
    });
  });

  describe('getSeriesSuggestions()', () => {
    it('sends GET /api/v1/media/series-suggestions with q', () => {
      const mock = [{ name: 'fate_stay_night', media_count: 5 }];
      service.getSeriesSuggestions('fate').subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne(r => r.url === '/api/v1/media/series-suggestions');
      expect(req.request.params.get('q')).toBe('fate');
      req.flush(mock);
    });
  });
});
