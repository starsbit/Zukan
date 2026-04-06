import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpEventType, HttpResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MediaClientService } from './media-client.service';
import { API_BASE_URL } from './api.config';
import { MediaListState, MediaVisibility, TagFilterMode, NsfwFilter, SensitiveFilter } from '../../models/media';

const mockPage = { total: 1, next_cursor: null, has_more: false, page_size: 20, items: [] };
const mockMedia = {
  id: 'm1', uploader_id: 'u1', owner_id: 'u1', visibility: MediaVisibility.PRIVATE,
  filename: 'test.webp', original_filename: 'test.webp', media_type: 'image' as const,
  metadata: { captured_at: '2026-01-01T00:00:00Z', file_size: 1000, width: 800, height: 600, duration_seconds: null, frame_count: null, mime_type: 'image/webp' },
  version: 1, created_at: '2026-01-01T00:00:00Z', deleted_at: null, tags: [],
  ocr_text_override: null, is_nsfw: false, is_sensitive: false, tagging_status: 'done' as const,
  tagging_error: null, thumbnail_status: 'done' as const, poster_status: 'pending' as const,
  ocr_text: null, is_favorited: false,
  tag_details: [], external_refs: [], entities: [],
};

describe('MediaClientService', () => {
  let service: MediaClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(MediaClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list sends GET /api/v1/media', () => {
    service.list().subscribe(res => expect(res).toEqual(mockPage));

    const req = http.expectOne('/api/v1/media');
    expect(req.request.method).toBe('GET');
    req.flush(mockPage);
  });

  it('list passes state and page_size params', () => {
    service.list({ state: MediaListState.TRASHED, page_size: 50 }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/media');
    expect(req.request.params.get('state')).toBe('trashed');
    expect(req.request.params.get('page_size')).toBe('50');
    req.flush(mockPage);
  });

  it('list passes visibility param', () => {
    service.list({ visibility: MediaVisibility.PUBLIC }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/media');
    expect(req.request.params.get('visibility')).toBe('public');
    req.flush(mockPage);
  });

  it('search sends GET /api/v1/media/search with tag array params', () => {
    service.search({ tag: ['cat', 'night'], mode: TagFilterMode.AND }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/media/search');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.getAll('tag')).toEqual(['cat', 'night']);
    expect(req.request.params.get('mode')).toBe('and');
    req.flush(mockPage);
  });

  it('search passes nsfw, sensitive, and favorited filters', () => {
    service.search({ nsfw: NsfwFilter.INCLUDE, sensitive: SensitiveFilter.ONLY, favorited: true }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/media/search');
    expect(req.request.params.get('nsfw')).toBe('include');
    expect(req.request.params.get('sensitive')).toBe('only');
    expect(req.request.params.get('favorited')).toBe('true');
    req.flush(mockPage);
  });

  it('search passes visibility filter', () => {
    service.search({ visibility: MediaVisibility.PUBLIC }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/media/search');
    expect(req.request.params.get('visibility')).toBe('public');
    req.flush(mockPage);
  });

  it('search passes exclude_tag array params', () => {
    service.search({ exclude_tag: ['bad', 'tag'] }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/media/search');
    expect(req.request.params.getAll('exclude_tag')).toEqual(['bad', 'tag']);
    req.flush(mockPage);
  });

  it('search passes advanced filter and sort params', () => {
    service.search({
      status: 'reviewed',
      series_name: 'Fate/stay night',
      visibility: MediaVisibility.PUBLIC,
      media_type: ['video', 'gif'],
      sort_by: 'filename',
      sort_order: 'asc',
      ocr_text: 'burning field',
      captured_year: 2026,
      captured_month: 3,
      captured_day: 29,
      captured_after: '2026-03-01T00:00',
      captured_before: '2026-03-31T23:59',
      captured_before_year: 2027,
    }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/media/search');
    expect(req.request.params.get('status')).toBe('reviewed');
    expect(req.request.params.get('series_name')).toBe('Fate/stay night');
    expect(req.request.params.get('visibility')).toBe('public');
    expect(req.request.params.getAll('media_type')).toEqual(['video', 'gif']);
    expect(req.request.params.get('sort_by')).toBe('filename');
    expect(req.request.params.get('sort_order')).toBe('asc');
    expect(req.request.params.get('ocr_text')).toBe('burning field');
    expect(req.request.params.get('captured_year')).toBe('2026');
    expect(req.request.params.get('captured_month')).toBe('3');
    expect(req.request.params.get('captured_day')).toBe('29');
    expect(req.request.params.get('captured_after')).toBe('2026-03-01T00:00');
    expect(req.request.params.get('captured_before')).toBe('2026-03-31T23:59');
    expect(req.request.params.get('captured_before_year')).toBe('2027');
    req.flush(mockPage);
  });

  it('getTimeline forwards active non-date filters', () => {
    service.getTimeline({
      tag: ['cat'],
      character_name: 'Rin Tohsaka',
      series_name: 'Fate/stay night',
      exclude_tag: ['spoiler'],
      mode: TagFilterMode.OR,
      nsfw: NsfwFilter.ONLY,
      sensitive: SensitiveFilter.INCLUDE,
      status: 'reviewed',
      favorited: false,
      visibility: MediaVisibility.PRIVATE,
      media_type: ['image'],
      ocr_text: 'moon',
    }).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/media/timeline');
    expect(req.request.params.getAll('tag')).toEqual(['cat']);
    expect(req.request.params.get('character_name')).toBe('Rin Tohsaka');
    expect(req.request.params.get('series_name')).toBe('Fate/stay night');
    expect(req.request.params.getAll('exclude_tag')).toEqual(['spoiler']);
    expect(req.request.params.get('mode')).toBe('or');
    expect(req.request.params.get('nsfw')).toBe('only');
    expect(req.request.params.get('sensitive')).toBe('include');
    expect(req.request.params.get('status')).toBe('reviewed');
    expect(req.request.params.get('favorited')).toBe('false');
    expect(req.request.params.get('visibility')).toBe('private');
    expect(req.request.params.getAll('media_type')).toEqual(['image']);
    expect(req.request.params.get('ocr_text')).toBe('moon');
    req.flush({ buckets: [] });
  });

  it('getTimeline excludes date and pagination params even when search uses them', () => {
    service.getTimeline({
      tag: ['hero'],
      status: 'flagged',
      favorited: false,
      captured_year: 2026,
      captured_month: 3,
      captured_day: 29,
      captured_after: '2026-03-01T00:00',
      captured_before: '2026-03-31T23:59',
      captured_before_year: 2027,
      after: 'cursor-1',
      page_size: 10,
      include_total: true,
    } as any).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/media/timeline');
    expect(req.request.params.getAll('tag')).toEqual(['hero']);
    expect(req.request.params.get('status')).toBe('flagged');
    expect(req.request.params.get('favorited')).toBe('false');
    expect(req.request.params.has('captured_year')).toBe(false);
    expect(req.request.params.has('captured_month')).toBe(false);
    expect(req.request.params.has('captured_day')).toBe(false);
    expect(req.request.params.has('captured_after')).toBe(false);
    expect(req.request.params.has('captured_before')).toBe(false);
    expect(req.request.params.has('captured_before_year')).toBe(false);
    expect(req.request.params.has('after')).toBe(false);
    expect(req.request.params.has('page_size')).toBe(false);
    expect(req.request.params.has('include_total')).toBe(false);
    req.flush({ buckets: [] });
  });

  it('get sends GET /api/v1/media/{id}', () => {
    service.get('m1').subscribe(res => expect(res).toEqual(mockMedia));

    const req = http.expectOne('/api/v1/media/m1');
    expect(req.request.method).toBe('GET');
    req.flush(mockMedia);
  });

  it('getSeriesSuggestions sends GET /api/v1/media/series-suggestions with q', () => {
    service.getSeriesSuggestions('fate', 5).subscribe();

    const req = http.expectOne(r => r.url === '/api/v1/media/series-suggestions');
    expect(req.request.params.get('q')).toBe('fate');
    expect(req.request.params.get('limit')).toBe('5');
    req.flush([{ name: 'Fate/stay night', media_count: 9 }]);
  });

  it('update sends PATCH /api/v1/media/{id} with body', () => {
    const body = { tags: ['saber'], version: 1 };

    service.update('m1', body).subscribe(res => expect(res).toEqual(mockMedia));

    const req = http.expectOne('/api/v1/media/m1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(body);
    req.flush(mockMedia);
  });

  it('delete sends DELETE /api/v1/media/{id}', () => {
    service.delete('m1').subscribe();

    const req = http.expectOne('/api/v1/media/m1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('restore sends POST /api/v1/media/{id}/restore', () => {
    service.restore('m1').subscribe();

    const req = http.expectOne('/api/v1/media/m1/restore');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('purge sends DELETE /api/v1/media/{id}/purge', () => {
    service.purge('m1').subscribe();

    const req = http.expectOne('/api/v1/media/m1/purge');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('batchUpdate sends PATCH /api/v1/media with body', () => {
    const body = { media_ids: ['m1', 'm2'], favorited: true };
    const mock = { processed: 2, skipped: 0 };

    service.batchUpdate(body).subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/media');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(body);
    req.flush(mock);
  });

  it('batchUpdateEntities sends PATCH /api/v1/media/entities with body', () => {
    const body = { media_ids: ['m1', 'm2'], character_names: ['Saber'], series_names: ['Fate'] };
    const mock = { processed: 2, skipped: 0 };

    service.batchUpdateEntities(body).subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/media/entities');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(body);
    req.flush(mock);
  });

  it('batchDelete sends POST /api/v1/media/actions/delete', () => {
    const body = { media_ids: ['m1'] };
    const mock = { processed: 1, skipped: 0 };

    service.batchDelete(body).subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/media/actions/delete');
    expect(req.request.method).toBe('POST');
    req.flush(mock);
  });

  it('batchPurge sends POST /api/v1/media/actions/purge', () => {
    const body = { media_ids: ['m1'] };
    const mock = { processed: 1, skipped: 0 };

    service.batchPurge(body).subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/media/actions/purge');
    expect(req.request.method).toBe('POST');
    req.flush(mock);
  });

  it('emptyTrash sends POST /api/v1/media/actions/empty-trash', () => {
    service.emptyTrash().subscribe();

    const req = http.expectOne('/api/v1/media/actions/empty-trash');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('queueTaggingJob sends POST /api/v1/media/{id}/tagging-jobs', () => {
    const mock = { queued: 1 };

    service.queueTaggingJob('m1').subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/media/m1/tagging-jobs');
    expect(req.request.method).toBe('POST');
    req.flush(mock);
  });

  it('batchQueueTaggingJobs sends POST /api/v1/media/tagging-jobs', () => {
    const mock = { queued: 2 };

    service.batchQueueTaggingJobs({ media_ids: ['m1', 'm2'] }).subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne('/api/v1/media/tagging-jobs');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ media_ids: ['m1', 'm2'] });
    req.flush(mock);
  });

  it('getCharacterSuggestions sends GET with q param', () => {
    const mock = [{ name: 'Saber', media_count: 5 }];

    service.getCharacterSuggestions('Sab').subscribe(res => expect(res).toEqual(mock));

    const req = http.expectOne(r => r.url === '/api/v1/media/character-suggestions');
    expect(req.request.params.get('q')).toBe('Sab');
    expect(req.request.params.get('limit')).toBe('20');
    req.flush(mock);
  });

  it('download sends POST /api/v1/media/download and returns blob', () => {
    const body = { media_ids: ['m1'] };
    const blob = new Blob(['data'], { type: 'application/zip' });

    service.download(body).subscribe(res => expect(res).toBeInstanceOf(Blob));

    const req = http.expectOne('/api/v1/media/download');
    expect(req.request.method).toBe('POST');
    req.flush(blob);
  });

  it('getThumbnail sends GET /api/v1/media/{id}/thumbnail', () => {
    const blob = new Blob(['img'], { type: 'image/webp' });

    service.getThumbnail('m1').subscribe(res => expect(res).toBeInstanceOf(Blob));

    const req = http.expectOne('/api/v1/media/m1/thumbnail');
    expect(req.request.method).toBe('GET');
    req.flush(blob);
  });

  it('getFile sends GET /api/v1/media/{id}/file', () => {
    const blob = new Blob(['data'], { type: 'image/webp' });

    service.getFile('m1').subscribe(res => expect(res).toBeInstanceOf(Blob));

    const req = http.expectOne('/api/v1/media/m1/file');
    expect(req.request.method).toBe('GET');
    req.flush(blob);
  });

  it('getPoster sends GET /api/v1/media/{id}/poster', () => {
    const blob = new Blob(['data'], { type: 'image/png' });

    service.getPoster('m1').subscribe(res => expect(res).toBeInstanceOf(Blob));

    const req = http.expectOne('/api/v1/media/m1/poster');
    expect(req.request.method).toBe('GET');
    req.flush(blob);
  });

  it('upload sends multipart POST to /api/v1/media', () => {
    const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
    const mock = { batch_id: 'b1', batch_url: '/batches/b1', batch_items_url: '/batches/b1/items', poll_after_seconds: 2, webhooks_supported: false, accepted: 1, duplicates: 0, errors: 0, results: [] };

    service.upload([file], { tags: ['saber'] }).subscribe(res => {
      if (res.type === HttpEventType.Response) {
        expect((res as HttpResponse<unknown>).body).toEqual(mock);
      }
    });

    const req = http.expectOne('/api/v1/media');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeInstanceOf(FormData);
    req.flush(mock);
  });

  it('upload appends visibility when provided', () => {
    const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' });

    service.upload([file], { visibility: MediaVisibility.PUBLIC }).subscribe();

    const req = http.expectOne('/api/v1/media');
    expect((req.request.body as FormData).get('visibility')).toBe('public');
    req.flush({ batch_id: 'b1', batch_url: '/batches/b1', batch_items_url: '/batches/b1/items', poll_after_seconds: 2, webhooks_supported: false, accepted: 1, duplicates: 0, errors: 0, results: [] });
  });

  it('upload appends per-file captured_at_values when provided', () => {
    const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' });

    service.upload([file], {
      captured_at_values: ['2024-02-03T04:05:06.000Z'],
    }).subscribe();

    const req = http.expectOne('/api/v1/media');
    expect((req.request.body as FormData).getAll('captured_at_values')).toEqual([
      '2024-02-03T04:05:06.000Z',
    ]);
    req.flush({ batch_id: 'b1', batch_url: '/batches/b1', batch_items_url: '/batches/b1/items', poll_after_seconds: 2, webhooks_supported: false, accepted: 1, duplicates: 0, errors: 0, results: [] });
  });
});
