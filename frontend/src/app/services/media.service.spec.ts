import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CLIENT_API_BASE_URL } from './web/api.config';
import { MediaClientService } from './web/media-client.service';
import { MediaService } from './media.service';

const createMedia = (id: string, overrides: Partial<Record<string, unknown>> = {}) => ({
  id,
  uploader_id: 'user-1',
  filename: `${id}.png`,
  original_filename: `${id}.png`,
  metadata: {
    file_size: 100,
    width: 10,
    height: 10,
    mime_type: 'image/png',
    captured_at: '2026-03-21T00:00:00Z'
  },
  tags: ['fox'],
  is_nsfw: false,
  tagging_status: 'done',
  thumbnail_status: 'ready',
  version: 1,
  created_at: '2026-03-21T00:00:00Z',
  deleted_at: null,
  is_favorited: false,
  ...overrides
});

describe('MediaService', () => {
  let service: MediaService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MediaService,
        MediaClientService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CLIENT_API_BASE_URL, useValue: 'http://api.example.test' }
      ]
    });

    service = TestBed.inject(MediaService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('loads a media page and refreshes it with the last query', async () => {
    const loadPromise = firstValueFrom(service.loadPage({ after: 'cursor-pg2', page_size: 10, favorited: true }));
    expect(service.snapshot.request.loading).toBe(true);

    const firstRequest = httpTesting.expectOne('http://api.example.test/media/search?after=cursor-pg2&page_size=10&favorited=true');
    firstRequest.flush({
      total: 1,
      next_cursor: null,
      page_size: 10,
      items: [createMedia('media-1', { is_favorited: true })]
    });

    await expect(loadPromise).resolves.toMatchObject({ total: 1 });
    expect(service.snapshot.pageQuery).toEqual({ after: 'cursor-pg2', page_size: 10, favorited: true });

    const refreshPromise = firstValueFrom(service.refreshPage());
    const refreshRequest = httpTesting.expectOne('http://api.example.test/media/search?after=cursor-pg2&page_size=10&favorited=true');
    refreshRequest.flush({ total: 0, next_cursor: null, page_size: 10, items: [] });

    await expect(refreshPromise).resolves.toMatchObject({ total: 0, items: [] });
  });

  it('loads and appends the next page of media items', async () => {
    service['stateSubject'].next({
      ...service.snapshot,
      pageQuery: { page_size: 2, tag: ['sky'] },
      page: {
        total: 4,
        next_cursor: 'cursor-next',
        page_size: 2,
        items: [createMedia('media-1'), createMedia('media-2')]
      },
      request: { loading: false, loaded: true, error: null }
    });

    const nextPagePromise = firstValueFrom(service.loadNextPage());
    const nextRequest = httpTesting.expectOne('http://api.example.test/media/search?page_size=2&tag=sky&after=cursor-next');
    nextRequest.flush({
      total: 4,
      next_cursor: null,
      page_size: 2,
      items: [createMedia('media-2'), createMedia('media-3'), createMedia('media-4')]
    });

    await expect(nextPagePromise).resolves.toMatchObject({ next_cursor: null });
    expect(service.snapshot.page?.items.map((item) => item.id)).toEqual(['media-1', 'media-2', 'media-3', 'media-4']);
  });

  it('does not load next page when all media has already been loaded', async () => {
    service['stateSubject'].next({
      ...service.snapshot,
      pageQuery: { page_size: 2 },
      page: {
        total: 2,
        next_cursor: null,
        page_size: 2,
        items: [createMedia('media-1'), createMedia('media-2')]
      },
      request: { loading: false, loaded: true, error: null }
    });

    await expect(firstValueFrom(service.loadNextPage())).resolves.toBeNull();
    httpTesting.expectNone((request) => request.urlWithParams.includes('/media?after'));
  });

  it('updates cached detail and current page items after a media mutation', async () => {
    service['stateSubject'].next({
      ...service.snapshot,
      pageQuery: { page_size: 20 },
      page: {
        total: 1,
        next_cursor: null,
        page_size: 20,
        items: [createMedia('media-1')]
      },
      details: {
        'media-1': createMedia('media-1')
      },
      selectedMediaId: 'media-1'
    });

    const updatePromise = firstValueFrom(service.updateMedia('media-1', { favorited: true }));
    const request = httpTesting.expectOne('http://api.example.test/media/media-1');
    expect(request.request.method).toBe('PATCH');
    request.flush(createMedia('media-1', { is_favorited: true }));

    await expect(updatePromise).resolves.toMatchObject({ is_favorited: true });
    expect(service.snapshot.details['media-1']?.is_favorited).toBe(true);
    expect(service.snapshot.page?.items[0]?.is_favorited).toBe(true);
  });

  it('removes restored media from the current trash page', async () => {
    service['stateSubject'].next({
      ...service.snapshot,
      pageQuery: { state: 'trashed' },
      page: {
        total: 1,
        next_cursor: null,
        page_size: 20,
        items: [createMedia('media-1', { deleted_at: '2026-03-21T00:00:00Z' })]
      },
      details: {
        'media-1': createMedia('media-1', { deleted_at: '2026-03-21T00:00:00Z' })
      }
    });

    const restorePromise = firstValueFrom(service.restoreMedia('media-1'));
    const request = httpTesting.expectOne('http://api.example.test/media/media-1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ deleted: false });
    request.flush(createMedia('media-1', { deleted_at: null }));

    await expect(restorePromise).resolves.toMatchObject({ deleted_at: null });
    expect(service.snapshot.page?.items).toEqual([]);
    expect(service.snapshot.page?.total).toBe(0);
  });

  it('selects cached media without making a request and loads uncached detail', async () => {
    service['stateSubject'].next({
      ...service.snapshot,
      details: {
        'media-1': createMedia('media-1')
      }
    });

    await expect(firstValueFrom(service.selectMedia('media-1'))).resolves.toMatchObject({ id: 'media-1' });
    httpTesting.expectNone('http://api.example.test/media/media-1');

    const loadPromise = firstValueFrom(service.selectMedia('media-2'));
    const request = httpTesting.expectOne('http://api.example.test/media/media-2');
    request.flush(createMedia('media-2'));
    await expect(loadPromise).resolves.toMatchObject({ id: 'media-2' });
    expect(service.snapshot.selectedMediaId).toBe('media-2');
  });

  it('handles uploads, downloads, and tagging job requests', async () => {
    service['stateSubject'].next({
      ...service.snapshot,
      page: { total: 1, next_cursor: null, page_size: 20, items: [createMedia('media-1')] },
      request: { loading: false, loaded: true, error: null }
    });

    const uploadPromise = firstValueFrom(service.uploadMedia([
      new File(['a'], 'a.png', { type: 'image/png' })
    ]));
    const uploadRequest = httpTesting.expectOne('http://api.example.test/media');
    uploadRequest.flush({ accepted: 1, duplicates: 0, errors: 0, results: [] });
    await expect(uploadPromise).resolves.toMatchObject({ accepted: 1 });
    expect(service.snapshot.page).toBeNull();
    expect(service.snapshot.request.loaded).toBe(false);

    const queuePromise = firstValueFrom(service.queueTaggingJob('media-1'));
    const queueRequest = httpTesting.expectOne('http://api.example.test/media/media-1/tagging-jobs');
    queueRequest.flush({ queued: 1 });
    await expect(queuePromise).resolves.toEqual({ queued: 1 });

    const downloadPromise = firstValueFrom(service.downloadMedia({ media_ids: ['media-1'] }));
    const downloadRequest = httpTesting.expectOne('http://api.example.test/media/download');
    const zipBlob = new Blob(['zip']);
    downloadRequest.flush(zipBlob);
    await expect(downloadPromise).resolves.toEqual(zipBlob);

    const filePromise = firstValueFrom(service.getMediaFile('media-1'));
    const fileRequest = httpTesting.expectOne('http://api.example.test/media/media-1/file');
    const fileBlob = new Blob(['file']);
    fileRequest.flush(fileBlob);
    await expect(filePromise).resolves.toEqual(fileBlob);

    const thumbnailPromise = firstValueFrom(service.getMediaThumbnail('media-1'));
    const thumbnailRequest = httpTesting.expectOne('http://api.example.test/media/media-1/thumbnail');
    const thumbBlob = new Blob(['thumb']);
    thumbnailRequest.flush(thumbBlob);
    await expect(thumbnailPromise).resolves.toEqual(thumbBlob);
  });

  it('patches and removes media collections for batch and delete operations', async () => {
    service['stateSubject'].next({
      ...service.snapshot,
      pageQuery: { state: 'active' },
      page: {
        total: 2,
        next_cursor: null,
        page_size: 20,
        items: [createMedia('media-1'), createMedia('media-2')]
      },
      details: {
        'media-1': createMedia('media-1'),
        'media-2': createMedia('media-2')
      },
      selectedMediaId: 'media-1'
    });

    const batchUpdatePromise = firstValueFrom(service.batchUpdateMedia({
      media_ids: ['media-1'],
      favorited: true,
      deleted: true
    }));
    const batchUpdateRequest = httpTesting.expectOne('http://api.example.test/media');
    expect(batchUpdateRequest.request.method).toBe('PATCH');
    batchUpdateRequest.flush({ processed: 1, skipped: 0 });
    await expect(batchUpdatePromise).resolves.toEqual({ processed: 1, skipped: 0 });
    expect(service.snapshot.page?.items.map((item) => item.id)).toEqual(['media-2']);
    expect(service.snapshot.details['media-1']).toBeUndefined();

    const batchDeletePromise = firstValueFrom(service.batchDeleteMedia({ media_ids: ['media-2'] }));
    const batchDeleteRequest = httpTesting.expectOne('http://api.example.test/media');
    expect(batchDeleteRequest.request.method).toBe('DELETE');
    batchDeleteRequest.flush({ processed: 1, skipped: 0 });
    await expect(batchDeletePromise).resolves.toEqual({ processed: 1, skipped: 0 });
    expect(service.snapshot.page?.items).toEqual([]);

    service['stateSubject'].next({
      ...service.snapshot,
      pageQuery: { state: 'active' },
      page: { total: 1, next_cursor: null, page_size: 20, items: [createMedia('media-3')] },
      details: { 'media-3': createMedia('media-3') },
      selectedMediaId: 'media-3'
    });

    const deletePromise = firstValueFrom(service.deleteMedia('media-3'));
    const deleteRequest = httpTesting.expectOne('http://api.example.test/media/media-3');
    deleteRequest.flush(null, { status: 204, statusText: 'No Content' });
    await expect(deletePromise).resolves.toBeNull();
    expect(service.snapshot.page?.items).toEqual([]);
    expect(service.snapshot.selectedMediaId).toBeNull();
  });

  it('invalidates trash views and keeps trashed batch updates in the current list', async () => {
    service['stateSubject'].next({
      ...service.snapshot,
      pageQuery: { state: 'trashed' },
      page: { total: 1, next_cursor: null, page_size: 20, items: [createMedia('media-1', { deleted_at: '2026-03-21T00:00:00Z' })] },
      details: { 'media-1': createMedia('media-1', { deleted_at: '2026-03-21T00:00:00Z' }) }
    });

    const batchUpdatePromise = firstValueFrom(service.batchUpdateMedia({
      media_ids: ['media-1'],
      favorited: true,
      deleted: true
    }));
    const batchUpdateRequest = httpTesting.expectOne('http://api.example.test/media');
    batchUpdateRequest.flush({ processed: 1, skipped: 0 });
    await expect(batchUpdatePromise).resolves.toEqual({ processed: 1, skipped: 0 });
    expect(service.snapshot.page?.items[0]?.is_favorited).toBe(true);

    const restoreBatchPromise = firstValueFrom(service.restoreMediaBatch(['media-1']));
    const restoreBatchRequest = httpTesting.expectOne('http://api.example.test/media');
    expect(restoreBatchRequest.request.method).toBe('PATCH');
    expect(restoreBatchRequest.request.body).toEqual({ media_ids: ['media-1'], deleted: false });
    restoreBatchRequest.flush({ processed: 1, skipped: 0 });
    await expect(restoreBatchPromise).resolves.toEqual({ processed: 1, skipped: 0 });
    expect(service.snapshot.page?.items).toEqual([]);
    expect(service.snapshot.page?.total).toBe(0);

    const emptyTrashPromise = firstValueFrom(service.emptyTrash());
    const emptyTrashRequest = httpTesting.expectOne('http://api.example.test/media/actions/empty-trash');
    emptyTrashRequest.flush(null, { status: 204, statusText: 'No Content' });
    await expect(emptyTrashPromise).resolves.toBeNull();
    expect(service.snapshot.page?.items).toEqual([]);

    service['stateSubject'].next({
      ...service.snapshot,
      pageQuery: { state: 'active' },
      page: { total: 1, next_cursor: null, page_size: 20, items: [createMedia('media-2')] },
      request: { loading: false, loaded: true, error: null }
    });

    const emptyActivePromise = firstValueFrom(service.emptyTrash());
    const emptyActiveRequest = httpTesting.expectOne('http://api.example.test/media/actions/empty-trash');
    emptyActiveRequest.flush(null, { status: 204, statusText: 'No Content' });
    await expect(emptyActivePromise).resolves.toBeNull();
    expect(service.snapshot.page).toBeNull();
    expect(service.snapshot.request.loaded).toBe(false);
  });

  it('records request and mutation failures', async () => {
    const loadPromise = firstValueFrom(service.loadPage({}));
    const loadRequest = httpTesting.expectOne('http://api.example.test/media');
    loadRequest.flush({ detail: 'broken' }, { status: 500, statusText: 'Server Error' });
    await expect(loadPromise).rejects.toMatchObject({ status: 500 });
    expect(service.snapshot.request.error).toMatchObject({ status: 500 });

    const updatePromise = firstValueFrom(service.updateMedia('media-1', { favorited: true }));
    const updateRequest = httpTesting.expectOne('http://api.example.test/media/media-1');
    updateRequest.flush({ detail: 'broken' }, { status: 500, statusText: 'Server Error' });
    await expect(updatePromise).rejects.toMatchObject({ status: 500 });
    expect(service.snapshot.mutationError).toMatchObject({ status: 500 });
    expect(service.snapshot.mutationPending).toBe(false);
  });
});
