import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlbumStore } from '../../services/album.store';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { GalleryStore } from '../../services/gallery.store';
import { MediaService } from '../../services/media.service';
import { UploadTrackerService } from '../../services/upload-tracker.service';
import { DayGroup } from '../../utils/gallery-grouping.utils';
import { MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../models/media';
import { MediaBrowserComponent } from './media-browser.component';

function makeMedia(id: string) {
  return {
    id,
    uploader_id: 'u1',
    uploader_username: 'uploader',
    owner_id: 'u1',
    owner_username: 'owner',
    visibility: MediaVisibility.PRIVATE,
    filename: `${id}.jpg`,
    original_filename: null,
    media_type: MediaType.IMAGE,
    metadata: {
      file_size: 100,
      width: 100,
      height: 100,
      duration_seconds: null,
      frame_count: null,
      mime_type: 'image/jpeg',
      captured_at: '2026-03-28T12:00:00Z',
    },
    version: 1,
    uploaded_at: '2026-03-28T12:00:00Z',
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
  };
}

describe('MediaBrowserComponent album action', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('adds the selected media to the chosen album and clears the selection', async () => {
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const albumStore = {
      addMedia: vi.fn(() => of({ processed: 1, skipped: 0 })),
      items: () => [],
      loading: () => false,
      loaded: () => true,
      load: vi.fn(() => of([])),
    };
    const dialog = {
      open: vi.fn(() => ({
        afterClosed: () => of({ albumId: 'album-1', albumName: 'Favorites' }),
      })),
    };
    const snackBar = {
      open: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [MediaBrowserComponent],
      providers: [
        provideRouter([]),
        { provide: MediaService, useValue: { getThumbnailUrl: () => of('blob:thumb'), getPosterUrl: () => of('blob:poster'), getFileUrl: () => of('blob:file') } },
        { provide: AlbumStore, useValue: albumStore },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: GalleryStore, useValue: { batchDelete: vi.fn(), batchQueueTaggingJobs: vi.fn(), batchUpdateVisibility: vi.fn() } },
        { provide: ConfirmDialogService, useValue: { open: vi.fn() } },
        { provide: UploadTrackerService, useValue: { registerRetagging: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m1')],
      },
    ] satisfies DayGroup[]);
    fixture.detectChanges();

    fixture.componentInstance.onMediaSelectionToggled(makeMedia('m1'));
    fixture.componentInstance.addSelectionToAlbum();

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(albumStore.addMedia).toHaveBeenCalledWith('album-1', ['m1']);
    expect(fixture.componentInstance.selectionCount()).toBe(0);
  });
});
