import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { MediaDetail, MediaRead, MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../../models/media';
import { MediaEntityType } from '../../../models/relations';
import { MediaService } from '../../../services/media.service';
import { MediaInspectorDialogComponent } from './media-inspector-dialog.component';

function makeMedia(overrides: Partial<MediaRead> = {}): MediaRead {
  return {
    id: 'm1',
    uploader_id: 'uploader-1',
    uploader_username: 'shirou',
    owner_id: 'owner-1',
    owner_username: 'rin',
    visibility: MediaVisibility.PUBLIC,
    filename: 'media.jpg',
    original_filename: 'hero-image.jpg',
    media_type: MediaType.IMAGE,
    metadata: {
      file_size: 2048,
      width: 1920,
      height: 1080,
      duration_seconds: null,
      frame_count: null,
      mime_type: 'image/jpeg',
      captured_at: '2026-03-24T15:07:11Z',
    },
    version: 1,
    created_at: '2026-03-24T15:07:13Z',
    deleted_at: null,
    tags: ['Saber', 'white hair'],
    ocr_text_override: null,
    is_nsfw: false,
    tagging_status: TaggingStatus.DONE,
    tagging_error: null,
    thumbnail_status: ProcessingStatus.DONE,
    poster_status: ProcessingStatus.NOT_APPLICABLE,
    ocr_text: 'Excalibur',
    is_favorited: false,
    favorite_count: 0,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<MediaDetail> = {}): MediaDetail {
  return {
    ...makeMedia(),
    tag_details: [],
    external_refs: [
      {
        id: 'ref-1',
        provider: 'pixiv',
        external_id: '75453892',
        url: 'https://www.pixiv.net/en/artworks/75453892',
      },
    ],
    entities: [
      {
        id: 'entity-1',
        entity_type: MediaEntityType.CHARACTER,
        entity_id: null,
        name: 'Saber Alter',
        role: 'primary',
        source: 'manual',
        confidence: 0.93,
      },
    ],
    ...overrides,
  };
}

describe('MediaInspectorDialogComponent', () => {
  it('loads media detail and renders metadata, characters, and tags', async () => {
    const mediaService = {
      get: vi.fn(() => of(makeDetail())),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaInspectorDialogComponent],
      providers: [
        { provide: MediaService, useValue: mediaService },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { media: makeMedia() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaInspectorDialogComponent);
    fixture.detectChanges();

    expect(mediaService.get).toHaveBeenCalledWith('m1');
    expect(mediaService.getFileUrl).toHaveBeenCalledWith('m1');
    expect(fixture.nativeElement.textContent).toContain('Metadata');
    expect(fixture.nativeElement.textContent).toContain('Author & Source');
    expect(fixture.nativeElement.textContent).toContain('Characters');
    expect(fixture.nativeElement.textContent).toContain('Saber Alter');
    expect(fixture.nativeElement.textContent).toContain('Tags');
    expect(fixture.nativeElement.textContent).toContain('white hair');
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('blob:file');
  });

  it('renders videos with native controls', async () => {
    const mediaService = {
      get: vi.fn(() => of(makeDetail({
        media_type: MediaType.VIDEO,
        poster_status: ProcessingStatus.DONE,
        metadata: {
          ...makeMedia().metadata,
          duration_seconds: 90,
        },
      }))),
      getFileUrl: vi.fn(() => of('blob:video')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaInspectorDialogComponent],
      providers: [
        { provide: MediaService, useValue: mediaService },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { media: makeMedia({ media_type: MediaType.VIDEO }) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaInspectorDialogComponent);
    fixture.detectChanges();

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video?.controls).toBe(true);
  });

  it('omits empty optional values and shows an error when loading fails', async () => {
    const mediaService = {
      get: vi.fn(() => throwError(() => new Error('failed'))),
      getFileUrl: vi.fn(() => throwError(() => new Error('failed'))),
    };

    await TestBed.configureTestingModule({
      imports: [MediaInspectorDialogComponent],
      providers: [
        { provide: MediaService, useValue: mediaService },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            media: makeMedia({
              original_filename: null,
              owner_id: null,
              owner_username: null,
              uploader_id: null,
              uploader_username: null,
              tags: [],
            }),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaInspectorDialogComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Unable to load');
    expect(fixture.nativeElement.textContent).not.toContain('Original filename');
    expect(fixture.nativeElement.textContent).not.toContain('Owner');
  });
});
