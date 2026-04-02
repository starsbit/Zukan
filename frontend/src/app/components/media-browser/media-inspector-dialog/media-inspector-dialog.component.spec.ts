import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { MediaDetail, MediaRead, MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../../models/media';
import { MediaEntityType } from '../../../models/relations';
import { GalleryStore } from '../../../services/gallery.store';
import { MediaService } from '../../../services/media.service';
import { TagsClientService } from '../../../services/web/tags-client.service';
import { MediaInspectorDialogComponent } from './media-inspector-dialog.component';

function makeMedia(id = 'm1', overrides: Partial<MediaRead> = {}): MediaRead {
  return {
    id,
    uploader_id: 'uploader-1',
    uploader_username: 'shirou',
    owner_id: 'owner-1',
    owner_username: 'rin',
    visibility: MediaVisibility.PUBLIC,
    filename: `${id}.jpg`,
    original_filename: `${id}-original.jpg`,
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

function makeDetail(id = 'm1', overrides: Partial<MediaDetail> = {}): MediaDetail {
  return {
    ...makeMedia(id),
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
      {
        id: 'entity-2',
        entity_type: MediaEntityType.SERIES,
        entity_id: null,
        name: 'Fate/stay night',
        role: 'primary',
        source: 'tagger',
        confidence: 0.88,
      },
    ],
    ...overrides,
  };
}

describe('MediaInspectorDialogComponent', () => {
  async function createComponent(overrides?: {
    get?: ReturnType<typeof vi.fn>;
    getFileUrl?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
    items?: MediaRead[];
  }) {
    const mediaService = {
      get: overrides?.get ?? vi.fn((id: string) => of(makeDetail(id))),
      getFileUrl: overrides?.getFileUrl ?? vi.fn((id: string) => of(`blob:${id}`)),
      update: overrides?.update ?? vi.fn((id: string, body: unknown) => of(makeDetail(id, body as Partial<MediaDetail>))),
      getCharacterSuggestions: vi.fn(() => of([{ name: 'Rin Tohsaka', media_count: 7 }])),
      getSeriesSuggestions: vi.fn(() => of([{ name: 'Fate/zero', media_count: 5 }])),
    };
    const galleryStore = {
      patchItem: vi.fn(),
    };
    const dialogRef = {
      close: vi.fn(),
    };
    const tagsClient = {
      list: vi.fn(() => of({ items: [{ id: 1, name: 'hero', category: 0, category_name: 'general', category_key: 'general', media_count: 10 }] })),
    };

    const items = overrides?.items ?? [makeMedia('m1'), makeMedia('m2', { media_type: MediaType.GIF })];

    await TestBed.configureTestingModule({
      imports: [MediaInspectorDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MediaService, useValue: mediaService },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: TagsClientService, useValue: tagsClient },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { items, activeMediaId: 'm1' } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaInspectorDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, mediaService, galleryStore, dialogRef, tagsClient, items };
  }

  it('loads media detail and renders metadata, characters, series, tags, and OCR sections', async () => {
    const { fixture, mediaService } = await createComponent();

    expect(mediaService.get).toHaveBeenCalledWith('m1');
    expect(mediaService.getFileUrl).toHaveBeenCalledWith('m1');
    expect(fixture.nativeElement.textContent).toContain('Summary');
    expect(fixture.nativeElement.textContent).toContain('Characters');
    expect(fixture.nativeElement.textContent).toContain('Saber Alter');
    expect(fixture.nativeElement.textContent).toContain('Series');
    expect(fixture.nativeElement.textContent).toContain('Fate/Stay Night');
    expect(fixture.nativeElement.textContent).toContain('Tags');
    expect(fixture.nativeElement.textContent).toContain('White Hair');
    expect(fixture.nativeElement.textContent).toContain('Detected text');
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('blob:m1');
  });

  it('renders videos with native controls', async () => {
    const { fixture } = await createComponent({
      items: [makeMedia('m1', { media_type: MediaType.VIDEO })],
      get: vi.fn(() => of(makeDetail('m1', {
        media_type: MediaType.VIDEO,
        poster_status: ProcessingStatus.DONE,
        metadata: {
          ...makeMedia('m1').metadata,
          duration_seconds: 90,
          mime_type: 'video/mp4',
        },
      }))),
      getFileUrl: vi.fn(() => of('blob:video')),
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video?.controls).toBe(true);
  });

  it('navigates between media items and loads the next item in place', async () => {
    const { fixture, mediaService } = await createComponent();

    fixture.componentInstance.next();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mediaService.get).toHaveBeenCalledWith('m2');
    expect(fixture.componentInstance.activeIndex()).toBe(1);
    expect(fixture.componentInstance.activeItem()?.id).toBe('m2');
  });

  it('supports keyboard navigation and escape close', async () => {
    const { fixture, dialogRef } = await createComponent();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.activeIndex()).toBe(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('resets zoom when navigating between items', async () => {
    const { fixture } = await createComponent();

    fixture.componentInstance['zoom'].set(2);
    fixture.componentInstance['panX'].set(10);
    fixture.componentInstance['panY'].set(8);

    fixture.componentInstance.next();

    expect(fixture.componentInstance.zoom()).toBe(1);
    expect(fixture.componentInstance.panX()).toBe(0);
    expect(fixture.componentInstance.panY()).toBe(0);
  });

  it('builds the combined save payload, clears empty values, and patches gallery state', async () => {
    const updated = makeDetail('m1', {
      tags: ['hero'],
      entities: [
        {
          id: 'entity-3',
          entity_type: MediaEntityType.CHARACTER,
          entity_id: null,
          name: 'Rin Tohsaka',
          role: 'primary',
          source: 'manual',
          confidence: null,
        },
        {
          id: 'entity-4',
          entity_type: MediaEntityType.SERIES,
          entity_id: null,
          name: 'Fate/zero',
          role: 'primary',
          source: 'manual',
          confidence: null,
        },
      ],
      ocr_text_override: null,
      version: 2,
    });
    const update = vi.fn(() => of(updated));
    const { fixture, mediaService, galleryStore } = await createComponent({ update });

    fixture.componentInstance.beginEdit();
    fixture.componentInstance.removeTag('Saber');
    fixture.componentInstance.removeTag('white hair');
    fixture.componentInstance.addTypedTag();
    fixture.componentInstance.selectTag('hero');
    fixture.componentInstance.removeCharacter('Saber Alter');
    fixture.componentInstance.selectCharacter('Rin Tohsaka');
    fixture.componentInstance.removeSeries('Fate/stay night');
    fixture.componentInstance.selectSeries('Fate/zero');
    fixture.componentInstance.updateOcrOverride('   ');
    fixture.componentInstance.save();
    await fixture.whenStable();

    expect(mediaService.update).toHaveBeenCalledWith('m1', {
      tags: ['hero'],
      entities: [
        { entity_type: MediaEntityType.CHARACTER, name: 'Rin Tohsaka' },
        { entity_type: MediaEntityType.SERIES, name: 'Fate/zero' },
      ],
      ocr_text_override: null,
      version: 1,
    });
    expect(galleryStore.patchItem).toHaveBeenCalledWith(updated);
    expect(fixture.componentInstance.editing()).toBe(false);
  });

  it('shows save errors and load failures without crashing', async () => {
    const { fixture, mediaService } = await createComponent({
      get: vi.fn(() => throwError(() => new Error('detail failed'))),
      getFileUrl: vi.fn(() => throwError(() => new Error('file failed'))),
      update: vi.fn(() => throwError(() => ({ status: 409 }))),
    });

    expect(fixture.nativeElement.textContent).toContain('Unable to load');

    fixture.componentInstance.save();
    expect(mediaService.update).toHaveBeenCalledTimes(1);
  });
});
