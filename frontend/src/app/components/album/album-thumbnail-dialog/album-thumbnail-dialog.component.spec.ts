import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../../models/media';
import { MediaService } from '../../../services/media.service';
import { AlbumsClientService } from '../../../services/web/albums-client.service';
import { AlbumThumbnailDialogComponent } from './album-thumbnail-dialog.component';

function makeMedia(id: string, mediaType: MediaType = MediaType.IMAGE) {
  return {
    id,
    uploader_id: 'u1',
    owner_id: 'u1',
    visibility: MediaVisibility.PRIVATE,
    filename: `${id}.jpg`,
    original_filename: null,
    media_type: mediaType,
    metadata: {
      file_size: 100,
      width: 100,
      height: 100,
      duration_seconds: null,
      frame_count: null,
      mime_type: mediaType === MediaType.GIF ? 'image/gif' : 'image/jpeg',
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

describe('AlbumThumbnailDialogComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('filters out non-image album media and returns a selected existing media id', async () => {
    const dialogRef = { close: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [AlbumThumbnailDialogComponent],
      providers: [
        {
          provide: AlbumsClientService,
          useValue: {
            listMedia: vi.fn(() => of({
              items: [makeMedia('m1'), makeMedia('m2', MediaType.GIF), makeMedia('m3', MediaType.VIDEO)],
              total: 3,
              next_cursor: null,
              has_more: false,
              page_size: 20,
            })),
          },
        },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MediaService, useValue: { getThumbnailUrl: vi.fn(() => of('blob:thumb')), getPosterUrl: vi.fn(), getFileUrl: vi.fn() } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            albumId: 'album-1',
            albumName: 'Favorites',
            currentCoverMediaId: null,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumThumbnailDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.mediaItems().map((item) => item.id)).toEqual(['m1', 'm2']);

    fixture.componentInstance.selectExisting('m2');
    fixture.componentInstance.save();

    expect(dialogRef.close).toHaveBeenCalledWith({ coverMediaId: 'm2' });
  });

  it('rejects non-image uploads and allows clearing back to the default cover', async () => {
    const dialogRef = { close: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [AlbumThumbnailDialogComponent],
      providers: [
        {
          provide: AlbumsClientService,
          useValue: {
            listMedia: vi.fn(() => of({
              items: [],
              total: 0,
              next_cursor: null,
              has_more: false,
              page_size: 20,
            })),
          },
        },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MediaService, useValue: { getThumbnailUrl: vi.fn(() => of('blob:thumb')), getPosterUrl: vi.fn(), getFileUrl: vi.fn() } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            albumId: 'album-1',
            albumName: 'Favorites',
            currentCoverMediaId: 'm1',
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumThumbnailDialogComponent);
    fixture.detectChanges();

    const fileInput = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const badFile = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    Object.defineProperty(fileInput, 'files', { value: [badFile] });
    fileInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.componentInstance.fileError()).toContain('Choose an image file');

    fixture.componentInstance.clearToDefault();
    expect(dialogRef.close).toHaveBeenCalledWith({ coverMediaId: null });
  });
});
