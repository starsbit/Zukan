import '@angular/compiler';
import { HttpEventType } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaUploadService } from './media-upload.service';
import { MediaClientService } from './web/media-client.service';
import { createMediaRead } from '../testing/media-test.utils';

describe('MediaUploadService', () => {
  let service: MediaUploadService;
  let mediaClient: {
    uploadMediaWithProgress: ReturnType<typeof vi.fn>;
    getMedia: ReturnType<typeof vi.fn>;
  };
  let snackBar: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mediaClient = {
      uploadMediaWithProgress: vi.fn(),
      getMedia: vi.fn()
    };
    snackBar = {
      open: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        MediaUploadService,
        { provide: MediaClientService, useValue: mediaClient },
        { provide: MatSnackBar, useValue: snackBar }
      ]
    });

    service = TestBed.inject(MediaUploadService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows a snackbar when upload is started without files', () => {
    service.startUpload([]);

    expect(snackBar.open).toHaveBeenCalledWith('Select at least one file to upload.', 'Close', { duration: 3000 });
    expect(service.snapshot.visible).toBe(false);
  });

  it('tracks upload progress, polls processing, and auto-minimizes after success', async () => {
    vi.useFakeTimers();

    try {
      const events$ = new Subject<any>();
      const refreshSpy = vi.fn();
      mediaClient.uploadMediaWithProgress.mockReturnValue(events$.asObservable());
      mediaClient.getMedia.mockReturnValue(of(createMediaRead({ id: 'media-1' })));
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
      expect(service.snapshot.phase).toBe('completed');
      expect(service.snapshot.processingProgress).toBe(100);
      expect(refreshSpy).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(4000);
      expect(service.snapshot.expanded).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('completes upload processing when image assets are ready even if tagging is still pending', async () => {
    vi.useFakeTimers();

    try {
      const events$ = new Subject<any>();
      mediaClient.uploadMediaWithProgress.mockReturnValue(events$.asObservable());
      mediaClient.getMedia.mockReturnValue(of(createMediaRead({
        id: 'media-1',
        media_type: 'image',
        tagging_status: 'pending',
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

      await vi.advanceTimersByTimeAsync(0);

      expect(mediaClient.getMedia).toHaveBeenCalledWith('media-1');
      expect(service.snapshot.phase).toBe('completed');
      expect(service.snapshot.active).toBe(false);
      expect(service.snapshot.processingProgress).toBe(100);
      expect(service.snapshot.items[0]?.status).toBe('done');
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
});
