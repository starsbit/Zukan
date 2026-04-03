import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, afterEach, expect, it, vi } from 'vitest';
import { MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../models/media';
import { BatchItemStatus, BatchStatus, BatchType, ProcessingStep } from '../models/processing';
import { GalleryStore } from './gallery.store';
import { MediaService } from './media.service';
import { BatchesClientService } from './web/batches-client.service';
import { UploadTrackerService } from './upload-tracker.service';

const emptyReviewPage = { total: 0, items: [], recommendation_groups: [] };

describe('UploadTrackerService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates duplicate and upload-error counts from upload responses', async () => {
    const get = vi.fn().mockReturnValue(of({
      id: 'b1',
      user_id: 'u1',
      type: BatchType.UPLOAD,
      status: BatchStatus.DONE,
      total_items: 1,
      queued_items: 0,
      processing_items: 0,
      done_items: 1,
      failed_items: 0,
      created_at: '2026-03-29T10:00:00Z',
      started_at: '2026-03-29T10:00:01Z',
      finished_at: '2026-03-29T10:00:10Z',
      last_heartbeat_at: '2026-03-29T10:00:10Z',
      app_version: null,
      worker_version: null,
      error_summary: null,
    }));
    const listItems = vi.fn().mockReturnValue(of({
      total: 1,
      next_cursor: null,
      has_more: false,
      page_size: 200,
      items: [{
        id: 'i1',
        batch_id: 'b1',
        media_id: 'm1',
        source_filename: 'done.jpg',
        status: BatchItemStatus.DONE,
        step: ProcessingStep.THUMBNAIL,
        progress_percent: 100,
        error: null,
        updated_at: '2026-03-29T10:00:10Z',
      }],
    }));

    await TestBed.configureTestingModule({
      providers: [
        UploadTrackerService,
        { provide: BatchesClientService, useValue: { get, listItems, listReviewItems: vi.fn(() => of(emptyReviewPage)) } },
        { provide: GalleryStore, useValue: { addAcceptedUploads: vi.fn(), patchItem: vi.fn(), resolveOptimisticMediaId: vi.fn(), clearOptimisticItems: vi.fn() } },
        { provide: MediaService, useValue: { get: vi.fn(() => of()) } },
      ],
    }).compileComponents();

    const service = TestBed.inject(UploadTrackerService);
    const requestId = service.registerPendingBatch(
      [new File(['a'], 'done.jpg'), new File(['b'], 'dup.jpg'), new File(['c'], 'bad.jpg')],
      MediaVisibility.PRIVATE,
    );
    service.markBatchUploading(requestId);
    service.registerBatchStarted(requestId, {
      batch_id: 'b1',
      batch_url: '/api/v1/me/import-batches/b1',
      batch_items_url: '/api/v1/me/import-batches/b1/items',
      poll_after_seconds: 2,
      webhooks_supported: false,
      accepted: 1,
      duplicates: 1,
      errors: 1,
      results: [
        { id: 'm1', batch_item_id: 'i1', original_filename: 'done.jpg', status: 'accepted', message: null },
        { id: 'm2', batch_item_id: 'i2', original_filename: 'dup.jpg', status: 'duplicate', message: 'Already exists' },
        { id: null, batch_item_id: null, original_filename: 'bad.jpg', status: 'error', message: 'Rejected by server' },
      ],
    }, [new File(['a'], 'done.jpg')], MediaVisibility.PRIVATE);

    await Promise.resolve();

    expect(service.summary().itemCounts.done).toBe(1);
    expect(service.summary().itemCounts.duplicate).toBe(1);
    expect(service.summary().itemCounts.upload_error).toBe(1);
    expect(service.itemsByFilter().duplicate[0]?.filename).toBe('dup.jpg');
    expect(service.itemsByFilter().upload_error[0]?.filename).toBe('bad.jpg');
  });

  it('tracks review-needed items for completed batches', async () => {
    const get = vi.fn().mockReturnValue(of({
      id: 'b1',
      user_id: 'u1',
      type: BatchType.UPLOAD,
      status: BatchStatus.DONE,
      total_items: 1,
      queued_items: 0,
      processing_items: 0,
      done_items: 1,
      failed_items: 0,
      created_at: '2026-03-29T10:00:00Z',
      started_at: '2026-03-29T10:00:01Z',
      finished_at: '2026-03-29T10:00:10Z',
      last_heartbeat_at: '2026-03-29T10:00:10Z',
      app_version: null,
      worker_version: null,
      error_summary: null,
    }));
    const listItems = vi.fn().mockReturnValue(of({
      total: 1,
      next_cursor: null,
      has_more: false,
      page_size: 200,
      items: [{
        id: 'i1',
        batch_id: 'b1',
        media_id: 'm1',
        source_filename: 'done.jpg',
        status: BatchItemStatus.DONE,
        step: ProcessingStep.TAG,
        progress_percent: 100,
        error: null,
        updated_at: '2026-03-29T10:00:10Z',
      }],
    }));
    const listReviewItems = vi.fn().mockReturnValue(of({
      total: 1,
      recommendation_groups: [],
      items: [{
        batch_item_id: 'i1',
        source_filename: 'done.jpg',
        missing_character: true,
        missing_series: false,
        entities: [],
        media: {
          id: 'm1',
          uploader_id: 'u1',
          uploader_username: 'uploader',
          owner_id: 'u1',
          owner_username: 'owner',
          visibility: MediaVisibility.PRIVATE,
          filename: 'done.jpg',
          original_filename: 'done.jpg',
          media_type: MediaType.IMAGE,
          metadata: {
            file_size: 1,
            width: 10,
            height: 10,
            duration_seconds: null,
            frame_count: null,
            mime_type: 'image/jpeg',
            captured_at: '2026-03-29T10:00:10Z',
          },
          version: 1,
          created_at: '2026-03-29T10:00:10Z',
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
        },
      }],
    }));

    await TestBed.configureTestingModule({
      providers: [
        UploadTrackerService,
        { provide: BatchesClientService, useValue: { get, listItems, listReviewItems } },
        { provide: GalleryStore, useValue: { addAcceptedUploads: vi.fn(), patchItem: vi.fn(), resolveOptimisticMediaId: vi.fn(), clearOptimisticItems: vi.fn() } },
        { provide: MediaService, useValue: { get: vi.fn(() => of()) } },
      ],
    }).compileComponents();

    const service = TestBed.inject(UploadTrackerService);
    const requestId = service.registerPendingBatch([new File(['a'], 'done.jpg')], MediaVisibility.PRIVATE);
    service.markBatchUploading(requestId);
    service.registerBatchStarted(requestId, {
      batch_id: 'b1',
      batch_url: '/api/v1/me/import-batches/b1',
      batch_items_url: '/api/v1/me/import-batches/b1/items',
      poll_after_seconds: 2,
      webhooks_supported: false,
      accepted: 1,
      duplicates: 0,
      errors: 0,
      results: [{ id: 'm1', batch_item_id: 'i1', original_filename: 'done.jpg', status: 'accepted', message: null }],
    }, [new File(['a'], 'done.jpg')], MediaVisibility.PRIVATE);

    await Promise.resolve();

    expect(service.summary().reviewItems).toBe(1);
    expect(service.summary().reviewBatchCount).toBe(1);
    expect(service.summary().latestReviewBatchId).toBe('b1');
    expect(service.getBatchReview('b1')?.reviewItems).toHaveLength(1);
  });

  it('polls active batches, merges paged items, and stops after terminal status', async () => {
    vi.useFakeTimers();

    const get = vi.fn()
      .mockReturnValueOnce(of({
        id: 'b1',
        user_id: 'u1',
        type: BatchType.UPLOAD,
        status: BatchStatus.RUNNING,
        total_items: 3,
        queued_items: 1,
        processing_items: 1,
        done_items: 1,
        failed_items: 0,
        created_at: '2026-03-29T10:00:00Z',
        started_at: '2026-03-29T10:00:01Z',
        finished_at: null,
        last_heartbeat_at: '2026-03-29T10:00:03Z',
        app_version: null,
        worker_version: null,
        error_summary: null,
      }))
      .mockReturnValueOnce(of({
        id: 'b1',
        user_id: 'u1',
        type: BatchType.UPLOAD,
        status: BatchStatus.DONE,
        total_items: 3,
        queued_items: 0,
        processing_items: 0,
        done_items: 3,
        failed_items: 0,
        created_at: '2026-03-29T10:00:00Z',
        started_at: '2026-03-29T10:00:01Z',
        finished_at: '2026-03-29T10:00:05Z',
        last_heartbeat_at: '2026-03-29T10:00:05Z',
        app_version: null,
        worker_version: null,
        error_summary: null,
      }));
    const listItems = vi.fn()
      .mockReturnValueOnce(of({
        total: 3,
        next_cursor: 'cursor-2',
        has_more: true,
        page_size: 200,
        items: [{
          id: 'i1',
          batch_id: 'b1',
          media_id: 'm1',
          source_filename: 'one.jpg',
          status: BatchItemStatus.DONE,
          step: ProcessingStep.THUMBNAIL,
          progress_percent: 100,
          error: null,
          updated_at: '2026-03-29T10:00:02Z',
        }],
      }))
      .mockReturnValueOnce(of({
        total: 3,
        next_cursor: null,
        has_more: false,
        page_size: 200,
        items: [
          {
            id: 'i2',
            batch_id: 'b1',
            media_id: 'm2',
            source_filename: 'two.jpg',
            status: BatchItemStatus.PROCESSING,
            step: ProcessingStep.TAG,
            progress_percent: 55,
            error: null,
            updated_at: '2026-03-29T10:00:03Z',
          },
          {
            id: 'i3',
            batch_id: 'b1',
            media_id: 'm3',
            source_filename: 'three.jpg',
            status: BatchItemStatus.PENDING,
            step: null,
            progress_percent: null,
            error: null,
            updated_at: '2026-03-29T10:00:03Z',
          },
        ],
      }))
      .mockReturnValueOnce(of({
        total: 3,
        next_cursor: null,
        has_more: false,
        page_size: 200,
        items: [
          {
            id: 'i1',
            batch_id: 'b1',
            media_id: 'm1',
            source_filename: 'one.jpg',
            status: BatchItemStatus.DONE,
            step: ProcessingStep.THUMBNAIL,
            progress_percent: 100,
            error: null,
            updated_at: '2026-03-29T10:00:05Z',
          },
          {
            id: 'i2',
            batch_id: 'b1',
            media_id: 'm2',
            source_filename: 'two.jpg',
            status: BatchItemStatus.DONE,
            step: ProcessingStep.TAG,
            progress_percent: 100,
            error: null,
            updated_at: '2026-03-29T10:00:05Z',
          },
          {
            id: 'i3',
            batch_id: 'b1',
            media_id: 'm3',
            source_filename: 'three.jpg',
            status: BatchItemStatus.DONE,
            step: ProcessingStep.INGEST,
            progress_percent: 100,
            error: null,
            updated_at: '2026-03-29T10:00:05Z',
          },
        ],
      }));

    await TestBed.configureTestingModule({
      providers: [
        UploadTrackerService,
        { provide: BatchesClientService, useValue: { get, listItems, listReviewItems: vi.fn(() => of(emptyReviewPage)) } },
        { provide: GalleryStore, useValue: { addAcceptedUploads: vi.fn(), patchItem: vi.fn(), resolveOptimisticMediaId: vi.fn(), clearOptimisticItems: vi.fn() } },
        { provide: MediaService, useValue: { get: vi.fn(() => of()) } },
      ],
    }).compileComponents();

    const service = TestBed.inject(UploadTrackerService);
    const requestId = service.registerPendingBatch([new File(['a'], 'one.jpg')], MediaVisibility.PUBLIC);
    service.markBatchUploading(requestId);
    service.registerBatchStarted(requestId, {
      batch_id: 'b1',
      batch_url: '/api/v1/me/import-batches/b1',
      batch_items_url: '/api/v1/me/import-batches/b1/items',
      poll_after_seconds: 1,
      webhooks_supported: false,
      accepted: 1,
      duplicates: 0,
      errors: 0,
      results: [],
    }, [new File(['a'], 'one.jpg')], MediaVisibility.PUBLIC);

    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(1);
    expect(listItems).toHaveBeenCalledTimes(2);
    expect(service.summary().itemCounts.pending).toBe(1);
    expect(service.summary().itemCounts.processing).toBe(1);
    expect(service.itemsByFilter().processing).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(listItems).toHaveBeenCalledTimes(3);
    expect(service.summary().itemCounts.done).toBe(3);
    expect(service.hasActiveWork()).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('surfaces failed upload requests separately from processing failures', async () => {
    await TestBed.configureTestingModule({
      providers: [
        UploadTrackerService,
        { provide: BatchesClientService, useValue: { get: vi.fn(), listItems: vi.fn(), listReviewItems: vi.fn(() => of(emptyReviewPage)) } },
        { provide: GalleryStore, useValue: { addAcceptedUploads: vi.fn(), patchItem: vi.fn(), resolveOptimisticMediaId: vi.fn(), clearOptimisticItems: vi.fn() } },
        { provide: MediaService, useValue: { get: vi.fn(() => of()) } },
      ],
    }).compileComponents();

    const service = TestBed.inject(UploadTrackerService);
    const requestId = service.registerPendingBatch(
      [new File(['a'], 'one.jpg'), new File(['b'], 'two.jpg')],
      MediaVisibility.PRIVATE,
    );
    service.markBatchUploading(requestId);
    service.registerBatchRequestFailed(requestId, [new File(['a'], 'one.jpg'), new File(['b'], 'two.jpg')], 'Network error');

    expect(service.summary().requestCounts.failed).toBe(1);
    expect(service.summary().itemCounts.upload_error).toBe(2);
    expect(service.itemsByFilter().upload_error.map((item) => item.filename)).toEqual(['one.jpg', 'two.jpg']);
  });

  it('resolves completed media one after another and patches the gallery store', async () => {
    const galleryStore = {
      addAcceptedUploads: vi.fn(),
      patchItem: vi.fn(),
      resolveOptimisticMediaId: vi.fn(),
      clearOptimisticItems: vi.fn(),
    };
    const get = vi.fn().mockReturnValue(of({
      id: 'b1',
      user_id: 'u1',
      type: BatchType.UPLOAD,
      status: BatchStatus.DONE,
      total_items: 2,
      queued_items: 0,
      processing_items: 0,
      done_items: 2,
      failed_items: 0,
      created_at: '2026-03-29T10:00:00Z',
      started_at: '2026-03-29T10:00:01Z',
      finished_at: '2026-03-29T10:00:05Z',
      last_heartbeat_at: '2026-03-29T10:00:05Z',
      app_version: null,
      worker_version: null,
      error_summary: null,
    }));
    const listItems = vi.fn().mockReturnValue(of({
      total: 2,
      next_cursor: null,
      has_more: false,
      page_size: 200,
      items: [
        {
          id: 'i1',
          batch_id: 'b1',
          media_id: 'm1',
          source_filename: 'one.jpg',
          status: BatchItemStatus.DONE,
          step: ProcessingStep.THUMBNAIL,
          progress_percent: 100,
          error: null,
          updated_at: '2026-03-29T10:00:04Z',
        },
        {
          id: 'i2',
          batch_id: 'b1',
          media_id: 'm2',
          source_filename: 'two.jpg',
          status: BatchItemStatus.DONE,
          step: ProcessingStep.TAG,
          progress_percent: 100,
          error: null,
          updated_at: '2026-03-29T10:00:05Z',
        },
      ],
    }));
    const mediaService = {
      get: vi.fn((id: string) => of({
        id,
        uploader_id: 'u1',
        owner_id: 'u1',
        visibility: MediaVisibility.PRIVATE,
        filename: `${id}.jpg`,
        original_filename: `${id}.jpg`,
        media_type: MediaType.IMAGE,
        metadata: {
          file_size: 100,
          width: 10,
          height: 10,
          duration_seconds: null,
          frame_count: null,
          mime_type: 'image/jpeg',
          captured_at: '2026-03-29T10:00:00Z',
        },
        version: 1,
        created_at: '2026-03-29T10:00:00Z',
        deleted_at: null,
        tags: ['tagged'],
        ocr_text_override: null,
        is_nsfw: false,
        tagging_status: TaggingStatus.DONE,
        tagging_error: null,
        thumbnail_status: ProcessingStatus.DONE,
        poster_status: ProcessingStatus.NOT_APPLICABLE,
        ocr_text: null,
        is_favorited: false,
        tag_details: [],
        external_refs: [],
        entities: [],
      })),
    };

    await TestBed.configureTestingModule({
      providers: [
        UploadTrackerService,
        { provide: BatchesClientService, useValue: { get, listItems, listReviewItems: vi.fn(() => of(emptyReviewPage)) } },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: MediaService, useValue: mediaService },
      ],
    }).compileComponents();

    const service = TestBed.inject(UploadTrackerService);
    const requestId = service.registerPendingBatch(
      [new File(['a'], 'one.jpg'), new File(['b'], 'two.jpg')],
      MediaVisibility.PRIVATE,
    );
    service.markBatchUploading(requestId);
    service.registerBatchStarted(requestId, {
      batch_id: 'b1',
      batch_url: '/api/v1/me/import-batches/b1',
      batch_items_url: '/api/v1/me/import-batches/b1/items',
      poll_after_seconds: 1,
      webhooks_supported: false,
      accepted: 2,
      duplicates: 0,
      errors: 0,
      results: [
        { id: 'm1', batch_item_id: 'i1', original_filename: 'one.jpg', status: 'accepted', message: null },
        { id: 'm2', batch_item_id: 'i2', original_filename: 'two.jpg', status: 'accepted', message: null },
      ],
    }, [new File(['a'], 'one.jpg'), new File(['b'], 'two.jpg')], MediaVisibility.PRIVATE);

    expect(galleryStore.addAcceptedUploads).toHaveBeenCalledWith(
      expect.any(Array),
      MediaVisibility.PRIVATE,
      'b1',
      ['m1', 'm2'],
    );
    expect(galleryStore.resolveOptimisticMediaId).toHaveBeenNthCalledWith(1, 'b1', 'one.jpg', 'm1');
    expect(galleryStore.resolveOptimisticMediaId).toHaveBeenNthCalledWith(2, 'b1', 'two.jpg', 'm2');
    expect(mediaService.get).toHaveBeenNthCalledWith(1, 'm1');
    expect(mediaService.get).toHaveBeenNthCalledWith(2, 'm2');
    expect(galleryStore.patchItem).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'm1', tags: ['tagged'] }));
    expect(galleryStore.patchItem).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'm2', tags: ['tagged'] }));
  });

  it('tracks retagged media in the island and polls until tagging completes', async () => {
    vi.useFakeTimers();

    const galleryStore = {
      addAcceptedUploads: vi.fn(),
      patchItem: vi.fn(),
      resolveOptimisticMediaId: vi.fn(),
      clearOptimisticItems: vi.fn(),
    };
    const mediaService = {
      get: vi.fn()
        .mockReturnValueOnce(of({
          id: 'm1',
          uploader_id: 'u1',
          owner_id: 'u1',
          visibility: MediaVisibility.PRIVATE,
          filename: 'one.jpg',
          original_filename: 'one.jpg',
          media_type: MediaType.IMAGE,
          metadata: {
            file_size: 100,
            width: 10,
            height: 10,
            duration_seconds: null,
            frame_count: null,
            mime_type: 'image/jpeg',
            captured_at: '2026-03-29T10:00:00Z',
          },
          version: 1,
          created_at: '2026-03-29T10:00:00Z',
          deleted_at: null,
          tags: [],
          ocr_text_override: null,
          is_nsfw: false,
          tagging_status: TaggingStatus.PROCESSING,
          tagging_error: null,
          thumbnail_status: ProcessingStatus.DONE,
          poster_status: ProcessingStatus.NOT_APPLICABLE,
          ocr_text: null,
          is_favorited: false,
          favorite_count: 0,
          tag_details: [],
          external_refs: [],
          entities: [],
        }))
        .mockReturnValueOnce(of({
          id: 'm1',
          uploader_id: 'u1',
          owner_id: 'u1',
          visibility: MediaVisibility.PRIVATE,
          filename: 'one.jpg',
          original_filename: 'one.jpg',
          media_type: MediaType.IMAGE,
          metadata: {
            file_size: 100,
            width: 10,
            height: 10,
            duration_seconds: null,
            frame_count: null,
            mime_type: 'image/jpeg',
            captured_at: '2026-03-29T10:00:00Z',
          },
          version: 1,
          created_at: '2026-03-29T10:00:00Z',
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
          tag_details: [],
          external_refs: [],
          entities: [],
        })),
    };

    await TestBed.configureTestingModule({
      providers: [
        UploadTrackerService,
        { provide: BatchesClientService, useValue: { get: vi.fn(), listItems: vi.fn(), listReviewItems: vi.fn(() => of(emptyReviewPage)) } },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: MediaService, useValue: mediaService },
      ],
    }).compileComponents();

    const service = TestBed.inject(UploadTrackerService);
    service.registerRetagging([{
      ...{
        id: 'm1',
        uploader_id: 'u1',
        owner_id: 'u1',
        visibility: MediaVisibility.PRIVATE,
        filename: 'one.jpg',
        original_filename: 'one.jpg',
        media_type: MediaType.IMAGE,
        metadata: {
          file_size: 100,
          width: 10,
          height: 10,
          duration_seconds: null,
          frame_count: null,
          mime_type: 'image/jpeg',
          captured_at: '2026-03-29T10:00:00Z',
        },
        version: 1,
        created_at: '2026-03-29T10:00:00Z',
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
      },
    }]);

    expect(service.visible()).toBe(true);
    expect(service.summary().itemCounts.processing).toBe(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(service.summary().itemCounts.done).toBe(1);
    expect(service.hasActiveWork()).toBe(false);
    expect(galleryStore.patchItem).toHaveBeenCalled();
  });

  it('reset clears tracked upload state and cancels pending polling', async () => {
    vi.useFakeTimers();

    const get = vi.fn().mockReturnValue(of({
      id: 'b1',
      user_id: 'u1',
      type: BatchType.UPLOAD,
      status: BatchStatus.RUNNING,
      total_items: 1,
      queued_items: 1,
      processing_items: 0,
      done_items: 0,
      failed_items: 0,
      created_at: '2026-03-29T10:00:00Z',
      started_at: '2026-03-29T10:00:01Z',
      finished_at: null,
      last_heartbeat_at: '2026-03-29T10:00:03Z',
      app_version: null,
      worker_version: null,
      error_summary: null,
    }));
    const listItems = vi.fn().mockReturnValue(of({
      total: 1,
      next_cursor: null,
      has_more: false,
      page_size: 200,
      items: [{
        id: 'i1',
        batch_id: 'b1',
        media_id: 'm1',
        source_filename: 'one.jpg',
        status: BatchItemStatus.PENDING,
        step: ProcessingStep.INGEST,
        progress_percent: 0,
        error: null,
        updated_at: '2026-03-29T10:00:03Z',
      }],
    }));

    const galleryStore = {
      addAcceptedUploads: vi.fn(),
      patchItem: vi.fn(),
      resolveOptimisticMediaId: vi.fn(),
      clearOptimisticItems: vi.fn(),
    };

    await TestBed.configureTestingModule({
      providers: [
        UploadTrackerService,
        { provide: BatchesClientService, useValue: { get, listItems, listReviewItems: vi.fn(() => of(emptyReviewPage)) } },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: MediaService, useValue: { get: vi.fn(() => of()) } },
      ],
    }).compileComponents();

    const service = TestBed.inject(UploadTrackerService);
    const requestId = service.registerPendingBatch([new File(['a'], 'one.jpg')], MediaVisibility.PRIVATE);
    service.markBatchUploading(requestId);
    service.registerBatchStarted(requestId, {
      batch_id: 'b1',
      batch_url: '/api/v1/me/import-batches/b1',
      batch_items_url: '/api/v1/me/import-batches/b1/items',
      poll_after_seconds: 1,
      webhooks_supported: false,
      accepted: 1,
      duplicates: 0,
      errors: 0,
      results: [],
    }, [new File(['a'], 'one.jpg')], MediaVisibility.PRIVATE);

    await Promise.resolve();
    expect(service.visible()).toBe(true);
    expect(service.summary().totalTrackedItems).toBe(1);

    service.reset();

    expect(service.visible()).toBe(false);
    expect(service.hasTrackedUploads()).toBe(false);
    expect(service.summary().totalTrackedItems).toBe(0);
    expect(galleryStore.clearOptimisticItems).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('reset clears optimistic gallery uploads so they do not leak across account switches', async () => {
    const galleryStore = {
      addAcceptedUploads: vi.fn(),
      patchItem: vi.fn(),
      resolveOptimisticMediaId: vi.fn(),
      clearOptimisticItems: vi.fn(),
    };

    await TestBed.configureTestingModule({
      providers: [
        UploadTrackerService,
        { provide: BatchesClientService, useValue: { get: vi.fn(), listItems: vi.fn(), listReviewItems: vi.fn(() => of(emptyReviewPage)) } },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: MediaService, useValue: { get: vi.fn(() => of()) } },
      ],
    }).compileComponents();

    const service = TestBed.inject(UploadTrackerService);
    service.reset();

    expect(galleryStore.clearOptimisticItems).toHaveBeenCalledTimes(1);
  });
});
