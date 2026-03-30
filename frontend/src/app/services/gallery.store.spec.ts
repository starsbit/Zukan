import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { GalleryStore } from './gallery.store';
import { API_BASE_URL } from './web/api.config';
import { MediaRead, MediaType, TaggingStatus, ProcessingStatus, MediaVisibility } from '../models/media';

function makeMedia(id: string, captured_at = '2026-03-28T12:00:00Z') {
  return {
    id,
    uploader_id: 'u1', owner_id: 'u1', visibility: MediaVisibility.PRIVATE,
    filename: `${id}.jpg`, original_filename: null,
    media_type: MediaType.IMAGE,
    metadata: { file_size: 100, width: 10, height: 10, duration_seconds: null, frame_count: null, mime_type: 'image/jpeg', captured_at },
    version: 1, created_at: captured_at, deleted_at: null, tags: [],
    ocr_text_override: null, is_nsfw: false,
    tagging_status: TaggingStatus.DONE, tagging_error: null,
    thumbnail_status: ProcessingStatus.DONE, poster_status: ProcessingStatus.NOT_APPLICABLE,
    ocr_text: null, is_favorited: false, favorite_count: 0,
  };
}

function makePage(items: ReturnType<typeof makeMedia>[], has_more = false, next_cursor: string | null = null, total: number | null = null) {
  return { items, has_more, next_cursor, total: total ?? items.length, page_size: 20 };
}

describe('GalleryStore', () => {
  let store: GalleryStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    store = TestBed.inject(GalleryStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts with empty state', () => {
    expect(store.items()).toHaveLength(0);
    expect(store.hasMore()).toBe(false);
    expect(store.total()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.timeline()).toHaveLength(0);
    expect(store.timelineLoading()).toBe(false);
    expect(store.groupedByDay()).toHaveLength(0);
    expect(store.timelineByYear()).toHaveLength(0);
  });

  describe('load()', () => {
    it('populates items and pagination signals', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1'), makeMedia('m2')], true, 'c1', 10));

      expect(store.items()).toHaveLength(2);
      expect(store.hasMore()).toBe(true);
      expect(store.total()).toBe(10);
      expect(store.loading()).toBe(false);
    });

    it('replaces items on second call', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1')]));

      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m2')]));

      expect(store.items()).toHaveLength(1);
      expect(store.items()[0].id).toBe('m2');
    });

    it('sets loading=false and rethrows on error', () => {
      let err: unknown;
      store.load().subscribe({ error: e => (err = e) });
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush('', { status: 500, statusText: 'Server Error' });

      expect(store.loading()).toBe(false);
      expect(err).toBeTruthy();
    });

    it('passes current params to the search endpoint', () => {
      store.setParams({ tag: ['cat'], nsfw: 'include' as any, visibility: MediaVisibility.PUBLIC });
      store.load().subscribe();
      const req = http.expectOne(r => r.url === '/api/v1/media/search');
      expect(req.request.params.getAll('tag')).toEqual(['cat']);
      expect(req.request.params.get('nsfw')).toBe('include');
      expect(req.request.params.get('visibility')).toBe('public');
      req.flush(makePage([]));
    });
  });

  describe('loadMore()', () => {
    it('appends items using the stored cursor', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1')], true, 'cur1'));

      store.loadMore().subscribe();
      const req = http.expectOne(r => r.url === '/api/v1/media/search');
      expect(req.request.params.get('after')).toBe('cur1');
      req.flush(makePage([makeMedia('m2')], false, null));

      expect(store.items()).toHaveLength(2);
      expect(store.items()[1].id).toBe('m2');
      expect(store.hasMore()).toBe(false);
    });

    it('returns EMPTY when hasMore is false', () => {
      let emitted = false;
      store.loadMore().subscribe({ next: () => (emitted = true) });
      http.expectNone(r => r.url === '/api/v1/media/search');
      expect(emitted).toBe(false);
    });

    it('returns EMPTY when already loading', () => {
      store.load().subscribe();
      // loading is now true — loadMore should be a no-op
      store.loadMore().subscribe();
      const reqs = http.match(r => r.url === '/api/v1/media/search');
      expect(reqs).toHaveLength(1);
      reqs[0].flush(makePage([]));
    });
  });

  describe('setParams()', () => {
    it('updates params and resets list state', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1')], true, 'c1', 5));

      store.setParams({ tag: ['cat'] });

      expect(store.items()).toHaveLength(0);
      expect(store.hasMore()).toBe(false);
      expect(store.total()).toBeNull();
      expect(store.params()).toEqual({ tag: ['cat'] });
    });
  });

  describe('loadTimeline()', () => {
    it('populates timeline signal', () => {
      const tl = { buckets: [{ year: 2026, month: 3, count: 10 }, { year: 2025, month: 12, count: 5 }] };
      store.loadTimeline().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/timeline').flush(tl);

      expect(store.timeline()).toHaveLength(2);
      expect(store.timelineLoading()).toBe(false);
    });

    it('strips date navigation params before calling timeline endpoint', () => {
      store.setParams({ tag: ['cat'], visibility: MediaVisibility.PUBLIC, captured_year: 2026, captured_month: 3 });
      store.loadTimeline().subscribe();
      const req = http.expectOne(r => r.url === '/api/v1/media/timeline');
      expect(req.request.params.getAll('tag')).toEqual(['cat']);
      expect(req.request.params.get('visibility')).toBe('public');
      expect(req.request.params.has('captured_year')).toBe(false);
      expect(req.request.params.has('captured_month')).toBe(false);
      req.flush({ buckets: [] });
    });

    it('preserves non-date filters when loading timeline', () => {
      store.setParams({
        tag: ['cat'],
        exclude_tag: ['spoiler'],
        status: 'reviewed',
        visibility: MediaVisibility.PUBLIC,
        favorited: true,
        captured_year: 2026,
      });
      store.loadTimeline().subscribe();

      const req = http.expectOne(r => r.url === '/api/v1/media/timeline');
      expect(req.request.params.getAll('tag')).toEqual(['cat']);
      expect(req.request.params.getAll('exclude_tag')).toEqual(['spoiler']);
      expect(req.request.params.get('status')).toBe('reviewed');
      expect(req.request.params.get('visibility')).toBe('public');
      expect(req.request.params.get('favorited')).toBe('true');
      expect(req.request.params.has('captured_year')).toBe(false);
      req.flush({ buckets: [] });
    });

    it('sets timelineLoading=false and rethrows on error', () => {
      let err: unknown;
      store.loadTimeline().subscribe({ error: e => (err = e) });
      http.expectOne(r => r.url === '/api/v1/media/timeline')
        .flush('', { status: 500, statusText: 'Server Error' });

      expect(store.timelineLoading()).toBe(false);
      expect(err).toBeTruthy();
    });
  });

  describe('patchItem()', () => {
    it('updates the matching item in place', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1'), makeMedia('m2')]));

      store.patchItem({ ...makeMedia('m1'), tags: ['cat'] });

      expect(store.items()[0].tags).toEqual(['cat']);
      expect(store.items()[1].id).toBe('m2');
    });

    it('is a no-op for an id not in the list', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1')]));

      store.patchItem({ ...makeMedia('unknown'), tags: ['x'] });

      expect(store.items()).toHaveLength(2);
      expect(store.items()[0].id).toBe('unknown');
    });
  });

  describe('toggleFavorite()', () => {
    it('uses the batch update endpoint for a single favorite toggle', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1')]));

      const results: MediaRead[] = [];
      store.toggleFavorite(makeMedia('m1')).subscribe((value) => {
        results.push(value);
      });

      const req = http.expectOne('/api/v1/media');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ media_ids: ['m1'], favorited: true });
      req.flush({ processed: 1, skipped: 0 });

      expect(results[0]?.is_favorited).toBe(true);
      expect(store.items()[0].is_favorited).toBe(true);
      expect(store.items()[0].favorite_count).toBe(1);
    });

    it('removes media that no longer matches an active favorites filter', () => {
      store.setParams({ favorited: true });
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([
        { ...makeMedia('m1'), is_favorited: true, favorite_count: 1 },
      ], false, null, 1));

      store.toggleFavorite({ ...makeMedia('m1'), is_favorited: true, favorite_count: 1 }).subscribe();

      const req = http.expectOne('/api/v1/media');
      expect(req.request.body).toEqual({ media_ids: ['m1'], favorited: false });
      req.flush({ processed: 1, skipped: 0 });

      expect(store.items()).toHaveLength(0);
      expect(store.total()).toBe(0);
    });
  });

  describe('addAcceptedUploads()', () => {
    it('shows optimistic accepted uploads immediately with processing status', () => {
      const file = new File(['a'], 'fresh.jpg', { type: 'image/jpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.UTC(2026, 2, 29, 10, 0, 0) });

      store.addAcceptedUploads([file], MediaVisibility.PRIVATE, 'b1', ['m-accepted']);

      expect(store.items()).toHaveLength(1);
      expect(store.items()[0].id).toBe('m-accepted');
      expect(store.items()[0].thumbnail_status).toBe(ProcessingStatus.PENDING);
      expect(store.items()[0].client_is_optimistic).toBe(true);
      expect(store.items()[0].client_preview_url).toMatch(/^blob:/);
    });

    it('replaces optimistic uploads when the resolved media is patched in', () => {
      const file = new File(['a'], 'fresh.jpg', { type: 'image/jpeg' });
      store.addAcceptedUploads([file], MediaVisibility.PRIVATE, 'b1', ['m-accepted']);

      store.patchItem(makeMedia('m-accepted'));

      expect(store.items()).toHaveLength(1);
      expect(store.items()[0].id).toBe('m-accepted');
      expect(store.items()[0].client_is_optimistic).toBeUndefined();
      expect(store.items()[0].thumbnail_status).toBe(ProcessingStatus.DONE);
    });

    it('inserts optimistic uploads into the correct timeline position by captured date', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([
        makeMedia('newer', '2025-11-02T12:00:00Z'),
        makeMedia('older', '2025-10-24T12:00:00Z'),
      ]));

      const file = new File(['a'], 'middle.jpg', { type: 'image/jpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.UTC(2025, 9, 31, 12, 0, 0) });
      store.addAcceptedUploads([file], MediaVisibility.PRIVATE, 'b1', ['m-middle']);

      expect(store.groupedByDay().map((group) => group.date)).toEqual([
        '2025-11-02',
        '2025-10-31',
        '2025-10-24',
      ]);
    });

    it('keeps the optimistic local preview when the matching server item is still processing', () => {
      const file = new File(['a'], 'processing.jpg', { type: 'image/jpeg' });
      store.addAcceptedUploads([file], MediaVisibility.PRIVATE, 'b1', ['m-processing']);

      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([
        {
          ...makeMedia('m-processing'),
          thumbnail_status: ProcessingStatus.PROCESSING,
        },
      ]));

      expect(store.items()).toHaveLength(1);
      expect(store.items()[0].id).toBe('m-processing');
      expect(store.items()[0].client_preview_url).toMatch(/^blob:/);
      expect(store.items()[0].client_is_optimistic).toBe(true);
    });
  });

  describe('removeItem()', () => {
    it('removes the item and decrements total', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1'), makeMedia('m2')], false, null, 2));

      store.removeItem('m1');

      expect(store.items()).toHaveLength(1);
      expect(store.items()[0].id).toBe('m2');
      expect(store.total()).toBe(1);
    });

    it('does not decrement total when total is null', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush({ items: [makeMedia('m1')], has_more: false, next_cursor: null, total: null, page_size: 20 });

      store.removeItem('m1');
      expect(store.total()).toBeNull();
    });
  });

  describe('removeItems()', () => {
    it('removes multiple items and adjusts total', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search')
        .flush(makePage([makeMedia('m1'), makeMedia('m2'), makeMedia('m3')], false, null, 3));

      store.removeItems(['m1', 'm3']);

      expect(store.items()).toHaveLength(1);
      expect(store.items()[0].id).toBe('m2');
      expect(store.total()).toBe(1);
    });
  });

  describe('batch mutations', () => {
    it('batchDelete refreshes the gallery list and timeline after removing items', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1'), makeMedia('m2')], false, null, 2));
      store.loadTimeline().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/timeline').flush({
        buckets: [{ year: 2026, month: 3, count: 2 }],
      });

      let result: { processed: number; skipped: number } | null = null;
      store.batchDelete(['m1']).subscribe((value) => {
        result = value;
      });
      http.expectOne('/api/v1/media/actions/delete').flush({ processed: 1, skipped: 0 });
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m2')], false, null, 1));
      http.expectOne(r => r.url === '/api/v1/media/timeline').flush({
        buckets: [{ year: 2026, month: 3, count: 1 }],
      });

      expect(store.items()).toHaveLength(1);
      expect(store.items()[0].id).toBe('m2');
      expect(store.total()).toBe(1);
      expect(store.timeline()).toEqual([{ year: 2026, month: 3, count: 1 }]);
      expect(result).toEqual({ processed: 1, skipped: 0 });
    });

    it('batchUpdateVisibility refreshes the gallery list and timeline after updating visibility', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1'), makeMedia('m2')]));
      store.loadTimeline().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/timeline').flush({
        buckets: [{ year: 2026, month: 3, count: 2 }],
      });

      store.batchUpdateVisibility(['m2'], MediaVisibility.PUBLIC).subscribe();
      const req = http.expectOne('/api/v1/media');
      expect(req.request.body).toEqual({ media_ids: ['m2'], visibility: MediaVisibility.PUBLIC });
      req.flush({ processed: 1, skipped: 0 });
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([
        makeMedia('m1'),
        { ...makeMedia('m2'), visibility: MediaVisibility.PUBLIC },
      ]));
      http.expectOne(r => r.url === '/api/v1/media/timeline').flush({
        buckets: [{ year: 2026, month: 3, count: 2 }],
      });

      expect(store.items()[0].visibility).toBe(MediaVisibility.PRIVATE);
      expect(store.items()[1].visibility).toBe(MediaVisibility.PUBLIC);
    });

    it('batchQueueTaggingJobs refreshes the gallery list and timeline after queuing jobs', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1'), makeMedia('m3')]));
      store.loadTimeline().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/timeline').flush({
        buckets: [{ year: 2026, month: 3, count: 2 }],
      });

      let intermediateStatuses: TaggingStatus[] = [];
      store.batchQueueTaggingJobs(['m1', 'm3']).subscribe((result) => {
        expect(result).toEqual({ queued: 2 });
      });

      const req = http.expectOne('/api/v1/media/tagging-jobs');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ media_ids: ['m1', 'm3'] });
      req.flush({ queued: 2 });
      intermediateStatuses = store.items().map((item) => item.tagging_status);
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([
        { ...makeMedia('m1'), tagging_status: TaggingStatus.PENDING },
        { ...makeMedia('m3'), tagging_status: TaggingStatus.PENDING },
      ]));
      http.expectOne(r => r.url === '/api/v1/media/timeline').flush({
        buckets: [{ year: 2026, month: 3, count: 2 }],
      });

      expect(intermediateStatuses).toEqual([TaggingStatus.PENDING, TaggingStatus.PENDING]);
      expect(store.items()[0].tagging_status).toBe(TaggingStatus.PENDING);
      expect(store.items()[1].tagging_status).toBe(TaggingStatus.PENDING);
    });

    it('batchRestore refreshes the trash list and timeline after restoring items', () => {
      store.setParams({ state: 'trashed' as any });
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1'), makeMedia('m2')], false, null, 2));
      store.loadTimeline().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/timeline').flush({
        buckets: [{ year: 2026, month: 3, count: 2 }],
      });

      let result: { processed: number; skipped: number } | null = null;
      store.batchRestore(['m1']).subscribe((value) => {
        result = value;
      });

      const req = http.expectOne('/api/v1/media');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ media_ids: ['m1'], deleted: false });
      req.flush({ processed: 1, skipped: 0 });
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m2')], false, null, 1));
      http.expectOne(r => r.url === '/api/v1/media/timeline').flush({
        buckets: [{ year: 2026, month: 3, count: 1 }],
      });

      expect(store.items()).toHaveLength(1);
      expect(store.items()[0].id).toBe('m2');
      expect(store.timeline()).toEqual([{ year: 2026, month: 3, count: 1 }]);
      expect(result).toEqual({ processed: 1, skipped: 0 });
    });

    it('emptyTrash calls the empty-trash endpoint and refreshes the list and timeline', () => {
      store.setParams({ state: 'trashed' as any });
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1')], false, null, 1));
      store.loadTimeline().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/timeline').flush({
        buckets: [{ year: 2026, month: 3, count: 1 }],
      });

      store.emptyTrash().subscribe();

      const req = http.expectOne('/api/v1/media/actions/empty-trash');
      expect(req.request.method).toBe('POST');
      req.flush(null);
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([], false, null, 0));
      http.expectOne(r => r.url === '/api/v1/media/timeline').flush({ buckets: [] });

      expect(store.items()).toHaveLength(0);
      expect(store.timeline()).toEqual([]);
      expect(store.total()).toBe(0);
    });
  });

  describe('computed signals', () => {
    it('groupedByDay reflects current items', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([
        makeMedia('m1', '2026-03-28T08:00:00Z'),
        makeMedia('m2', '2026-03-28T20:00:00Z'),
        makeMedia('m3', '2026-03-27T12:00:00Z'),
      ]));

      const groups = store.groupedByDay();
      expect(groups).toHaveLength(2);
      expect(groups[0].date).toBe('2026-03-28');
      expect(groups[0].items).toHaveLength(2);
      expect(groups[1].date).toBe('2026-03-27');
    });

    it('timelineByYear reflects current timeline', () => {
      store.loadTimeline().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/timeline').flush({
        buckets: [
          { year: 2026, month: 3, count: 10 },
          { year: 2026, month: 2, count: 5 },
          { year: 2025, month: 12, count: 8 },
        ],
      });

      const byYear = store.timelineByYear();
      expect(byYear).toHaveLength(2);
      expect(byYear[0].year).toBe(2026);
      expect(byYear[0].count).toBe(15);
      expect(byYear[1].year).toBe(2025);
    });
  });

  describe('reset()', () => {
    it('clears all state', () => {
      store.load().subscribe();
      http.expectOne(r => r.url === '/api/v1/media/search').flush(makePage([makeMedia('m1')], true, 'c1'));

      store.reset();

      expect(store.items()).toHaveLength(0);
      expect(store.hasMore()).toBe(false);
      expect(store.total()).toBeNull();
      expect(store.loading()).toBe(false);
      expect(store.timeline()).toHaveLength(0);
      expect(store.params()).toEqual({});
    });
  });
});
