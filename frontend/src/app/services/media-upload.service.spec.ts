import '@angular/compiler';
import { HttpEventType } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaUploadService } from './media-upload.service';
import { ConfigClientService } from './web/config-client.service';
import { MediaClientService } from './web/media-client.service';
import { createMediaRead } from '../testing/media-test.utils';
import type { UploadReviewCandidate } from './media-upload.service';

describe('MediaUploadService', () => {
  let service: MediaUploadService;
  let mediaClient: {
    uploadMediaWithProgress: ReturnType<typeof vi.fn>;
    getMedia: ReturnType<typeof vi.fn>;
    listMedia: ReturnType<typeof vi.fn>;
  };
  let configClient: {
    getUploadConfig: ReturnType<typeof vi.fn>;
  };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let reviewEvents: UploadReviewCandidate[][];

  beforeEach(() => {
    mediaClient = {
      uploadMediaWithProgress: vi.fn(),
      getMedia: vi.fn().mockReturnValue(of(createMediaRead({ id: 'fallback-media' }))),
      listMedia: vi.fn().mockReturnValue(of({ items: [], total: 0, page: 1, page_size: 200 }))
    };
    configClient = {
      getUploadConfig: vi.fn().mockReturnValue(of({ max_batch_size: 100, max_upload_size_mb: 50 }))
    };
    snackBar = {
      open: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        MediaUploadService,
        { provide: MediaClientService, useValue: mediaClient },
        { provide: ConfigClientService, useValue: configClient },
        { provide: MatSnackBar, useValue: snackBar }
      ]
    });

    service = TestBed.inject(MediaUploadService);
    reviewEvents = [];
    service.reviewRequested$.subscribe((items) => reviewEvents.push(items));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows a snackbar when upload is started without files', () => {
    service.startUpload([]);

    expect(snackBar.open).toHaveBeenCalledWith('Select at least one file to upload.', 'Close', { duration: 3000 });
    expect(service.snapshot.visible).toBe(false);
  });

  it('tracks upload progress, refreshes queue state changes, polls processing, and auto-minimizes after success', async () => {
    vi.useFakeTimers();

    try {
      const events$ = new Subject<any>();
      const refreshSpy = vi.fn();
      mediaClient.uploadMediaWithProgress.mockReturnValue(events$.asObservable());
      mediaClient.getMedia.mockReturnValueOnce(of(createMediaRead({
        id: 'media-1',
        tagging_status: 'processing',
        thumbnail_status: 'done',
        poster_status: 'done'
      })));
      mediaClient.getMedia.mockReturnValueOnce(of(createMediaRead({ id: 'media-1' })));
      service.refreshRequested$.subscribe(refreshSpy);

      service.startUpload([new File(['a'], 'a.png', { type: 'image/png' })]);
      expect(service.snapshot.phase).toBe('uploading');

      events$.next({ type: HttpEventType.UploadProgress, loaded: 5, total: 10 });
      expect(service.snapshot.uploadProgress).toBe(50);

      events$.next({
        type: HttpEventType.Response,
        body: {
          accepted: 1,
          duplicates: 0,
          errors: 0,
          results: [{ id: 'media-1', original_filename: 'a.png', status: 'accepted' }]
        }
      });

      await vi.advanceTimersByTimeAsync(0);

      expect(mediaClient.getMedia).toHaveBeenCalledWith('media-1');
      expect(service.snapshot.phase).toBe('processing');
      expect(service.snapshot.processingProgress).toBe(0);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(service.getMediaTaggingStatus('media-1')).toBe('processing');

      await vi.advanceTimersByTimeAsync(2000);
      expect(service.snapshot.phase).toBe('completed');
      expect(service.snapshot.processingProgress).toBe(100);
      expect(refreshSpy).toHaveBeenCalledTimes(2);
      expect(service.getMediaTaggingStatus('media-1')).toBe('done');
      expect(reviewEvents).toEqual([]);

      await vi.advanceTimersByTimeAsync(4000);
      expect(service.snapshot.expanded).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling while tagging is pending even if image assets are ready', async () => {
    vi.useFakeTimers();

    try {
      const events$ = new Subject<any>();
      const refreshSpy = vi.fn();
      mediaClient.uploadMediaWithProgress.mockReturnValue(events$.asObservable());
      mediaClient.getMedia.mockReturnValueOnce(of(createMediaRead({
        id: 'media-1',
        media_type: 'image',
        tagging_status: 'pending',
        thumbnail_status: 'done',
        poster_status: 'done'
      })));
      mediaClient.getMedia.mockReturnValueOnce(of(createMediaRead({
        id: 'media-1',
        media_type: 'image',
        tagging_status: 'done',
        thumbnail_status: 'done',
        poster_status: 'done'
      })));
      service.refreshRequested$.subscribe(refreshSpy);

      service.startUpload([new File(['a'], 'a.png', { type: 'image/png' })]);

      events$.next({
        type: HttpEventType.Response,
        body: {
          accepted: 1,
          duplicates: 0,
          errors: 0,
          results: [{ id: 'media-1', original_filename: 'a.png', status: 'accepted' }]
        }
      });

      await vi.advanceTimersByTimeAsync(0);

      expect(mediaClient.getMedia).toHaveBeenCalledWith('media-1');
      expect(service.snapshot.phase).toBe('processing');
      expect(service.snapshot.active).toBe(true);
      expect(service.snapshot.processingProgress).toBe(0);
      expect(service.snapshot.items[0]?.status).toBe('processing');
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(service.getMediaTaggingStatus('media-1')).toBe('pending');

      await vi.advanceTimersByTimeAsync(2000);

      expect(service.snapshot.phase).toBe('completed');
      expect(service.snapshot.active).toBe(false);
      expect(service.snapshot.processingProgress).toBe(100);
      expect(service.snapshot.items[0]?.status).toBe('done');
      expect(refreshSpy).toHaveBeenCalledTimes(2);
      expect(service.getMediaTaggingStatus('media-1')).toBe('done');
      expect(reviewEvents[0]?.[0]?.issue).toBe('missing_character');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes gallery as each image finishes processing within the batch', async () => {
    vi.useFakeTimers();

    try {
      const events$ = new Subject<any>();
      const refreshSpy = vi.fn();
      mediaClient.uploadMediaWithProgress.mockReturnValue(events$.asObservable());
      mediaClient.getMedia
        .mockReturnValueOnce(of(createMediaRead({
          id: 'media-1',
          media_type: 'image',
          tagging_status: 'done',
          thumbnail_status: 'done',
          poster_status: 'done'
        })))
        .mockReturnValueOnce(of(createMediaRead({
          id: 'media-2',
          media_type: 'image',
          tagging_status: 'processing',
          thumbnail_status: 'done',
          poster_status: 'done'
        })))
        .mockReturnValueOnce(of(createMediaRead({
          id: 'media-1',
          media_type: 'image',
          tagging_status: 'done',
          thumbnail_status: 'done',
          poster_status: 'done'
        })))
        .mockReturnValueOnce(of(createMediaRead({
          id: 'media-2',
          media_type: 'image',
          tagging_status: 'done',
          thumbnail_status: 'done',
          poster_status: 'done'
        })));
      service.refreshRequested$.subscribe(refreshSpy);

      service.startUpload([
        new File(['a'], 'a.png', { type: 'image/png' }),
        new File(['b'], 'b.png', { type: 'image/png' })
      ]);

      events$.next({
        type: HttpEventType.Response,
        body: {
          accepted: 2,
          duplicates: 0,
          errors: 0,
          results: [
            { id: 'media-1', original_filename: 'a.png', status: 'accepted' },
            { id: 'media-2', original_filename: 'b.png', status: 'accepted' }
          ]
        }
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(service.snapshot.phase).toBe('processing');
      expect(service.snapshot.processingProgress).toBe(50);
      expect(refreshSpy).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(2000);
      expect(service.snapshot.phase).toBe('completed');
      expect(service.snapshot.processingProgress).toBe(100);
      expect(refreshSpy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits review candidates only for failed tagging and missing characters once processing settles', async () => {
    vi.useFakeTimers();

    try {
      const events$ = new Subject<any>();
      mediaClient.uploadMediaWithProgress.mockReturnValue(events$.asObservable());
      mediaClient.getMedia
        .mockReturnValueOnce(of(createMediaRead({
          id: 'media-1',
          tagging_status: 'done',
          thumbnail_status: 'done'
        })))
        .mockReturnValueOnce(of(createMediaRead({
          id: 'media-2',
          tagging_status: 'failed',
          tagging_error: 'RuntimeError: failed',
          thumbnail_status: 'done'
        })))
        .mockReturnValueOnce(of(createMediaRead({
          id: 'media-3',
          tagging_status: 'done',
          entities: [{ id: 'entity-1', entity_type: 'character', entity_id: null, name: 'ayanami_rei', role: 'primary', source: 'tagger', confidence: 0.95 }],
          thumbnail_status: 'done'
        })));

      service.startUpload([
        new File(['a'], 'a.png', { type: 'image/png' }),
        new File(['b'], 'b.png', { type: 'image/png' }),
        new File(['c'], 'c.png', { type: 'image/png' })
      ]);

      events$.next({
        type: HttpEventType.Response,
        body: {
          accepted: 3,
          duplicates: 0,
          errors: 0,
          results: [
            { id: 'media-1', original_filename: 'a.png', status: 'accepted' },
            { id: 'media-2', original_filename: 'b.png', status: 'accepted' },
            { id: 'media-3', original_filename: 'c.png', status: 'accepted' }
          ]
        }
      });

      await vi.advanceTimersByTimeAsync(0);

      expect(reviewEvents).toHaveLength(1);
      expect(reviewEvents[0]?.map((item) => item.issue)).toEqual(['missing_character', 'tagging_failed']);
      expect(reviewEvents[0]?.map((item) => item.media.id)).toEqual(['media-1', 'media-2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps terminal per-media statuses until the session is dismissed', async () => {
    vi.useFakeTimers();

    try {
      const events$ = new Subject<any>();
      mediaClient.uploadMediaWithProgress.mockReturnValue(events$.asObservable());
      mediaClient.getMedia.mockReturnValueOnce(of(createMediaRead({
        id: 'media-1',
        tagging_status: 'processing',
        thumbnail_status: 'done',
        poster_status: 'done'
      })));
      mediaClient.getMedia.mockReturnValueOnce(of(createMediaRead({
        id: 'media-1',
        tagging_status: 'done',
        thumbnail_status: 'done',
        poster_status: 'done'
      })));

      service.startUpload([new File(['a'], 'a.png', { type: 'image/png' })]);

      events$.next({
        type: HttpEventType.Response,
        body: {
          accepted: 1,
          duplicates: 0,
          errors: 0,
          results: [{ id: 'media-1', original_filename: 'a.png', status: 'accepted' }]
        }
      });

      await vi.advanceTimersByTimeAsync(2000);

      expect(service.getMediaTaggingStatus('media-1')).toBe('done');

      service.dismissSession();

      expect(service.getMediaTaggingStatus('media-1')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('finishes immediately with mixed upload results when nothing needs processing', () => {
    mediaClient.uploadMediaWithProgress.mockReturnValue(of({
      type: HttpEventType.Response,
      body: {
        accepted: 0,
        duplicates: 1,
        errors: 1,
        results: [
          { id: null, original_filename: 'a.png', status: 'duplicate', message: 'Already exists' },
          { id: null, original_filename: 'b.png', status: 'error', message: 'Unsupported type' }
        ]
      }
    }));

    service.startUpload([
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.txt', { type: 'text/plain' })
    ]);

    expect(service.snapshot.phase).toBe('completed_with_errors');
    expect(service.snapshot.active).toBe(false);
    expect(service.snapshot.items.map((item) => item.status)).toEqual(['duplicate', 'error']);
    expect(mediaClient.getMedia).not.toHaveBeenCalled();
  });

  it('shows a snackbar and failed state when the upload request errors', () => {
    const events$ = new Subject<any>();
    mediaClient.uploadMediaWithProgress.mockReturnValue(events$.asObservable());

    service.startUpload([new File(['a'], 'a.png', { type: 'image/png' })]);
    events$.error(new Error('broken'));

    expect(service.snapshot.phase).toBe('failed');
    expect(service.snapshot.active).toBe(false);
    expect(snackBar.open).toHaveBeenCalledWith('Upload failed. Please try again.', 'Close', { duration: 3000 });
  });

  it('splits uploads into sequential batches using backend-configured max batch size', () => {
    const firstBatch$ = new Subject<any>();
    const secondBatch$ = new Subject<any>();

    configClient.getUploadConfig.mockReturnValue(of({ max_batch_size: 2, max_upload_size_mb: 50 }));
    mediaClient.uploadMediaWithProgress
      .mockReturnValueOnce(firstBatch$.asObservable())
      .mockReturnValueOnce(secondBatch$.asObservable());

    service.startUpload([
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
      new File(['c'], 'c.png', { type: 'image/png' })
    ]);

    expect(mediaClient.uploadMediaWithProgress).toHaveBeenCalledTimes(1);
    expect((mediaClient.uploadMediaWithProgress.mock.calls[0]?.[0] as File[]).map((file) => file.name)).toEqual(['a.png', 'b.png']);

    firstBatch$.next({
      type: HttpEventType.Response,
      body: {
        accepted: 2,
        duplicates: 0,
        errors: 0,
        results: [
          { id: 'media-1', original_filename: 'a.png', status: 'accepted' },
          { id: 'media-2', original_filename: 'b.png', status: 'accepted' }
        ]
      }
    });

    expect(mediaClient.uploadMediaWithProgress).toHaveBeenCalledTimes(2);
    expect((mediaClient.uploadMediaWithProgress.mock.calls[1]?.[0] as File[]).map((file) => file.name)).toEqual(['c.png']);

    secondBatch$.next({
      type: HttpEventType.Response,
      body: {
        accepted: 1,
        duplicates: 0,
        errors: 0,
        results: [
          { id: 'media-3', original_filename: 'c.png', status: 'accepted' }
        ]
      }
    });

    expect(service.snapshot.accepted).toBe(3);
    expect(service.snapshot.items.map((item) => item.status)).toEqual(['processing', 'processing', 'processing']);
  });
});
