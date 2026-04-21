import { TestBed } from '@angular/core/testing';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    uploaded_at: '2026-03-24T15:07:13Z',
    deleted_at: null,
    tags: ['Saber', 'white hair'],
    ocr_text_override: null,
    is_nsfw: false,
    is_sensitive: false,
    is_nsfw_override: null,
    is_sensitive_override: null,
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
  afterEach(() => {
    vi.useRealTimers();
  });

  async function createComponent(overrides?: {
    get?: ReturnType<typeof vi.fn>;
    getFileUrl?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
    toggleFavorite?: ReturnType<typeof vi.fn>;
    items?: MediaRead[];
    isMobile?: boolean;
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
      toggleFavorite:
        overrides?.toggleFavorite ??
        vi.fn((media: MediaRead) =>
          of({
            ...media,
            is_favorited: !media.is_favorited,
            favorite_count: Math.max(0, (media.favorite_count ?? 0) + (media.is_favorited ? -1 : 1)),
          }),
        ),
    };
    const dialogRef = {
      close: vi.fn(),
    };
    const tagsClient = {
      list: vi.fn(() => of({ items: [{ id: 1, name: 'hero', category: 0, category_name: 'general', category_key: 'general', media_count: 10 }] })),
    };
    const breakpointObserver = {
      observe: vi.fn(() => of({ matches: overrides?.isMobile ?? false, breakpoints: {} })),
    };

    const items = overrides?.items ?? [makeMedia('m1'), makeMedia('m2', { media_type: MediaType.GIF })];

    await TestBed.configureTestingModule({
      imports: [MediaInspectorDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MediaService, useValue: mediaService },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: TagsClientService, useValue: tagsClient },
        { provide: BreakpointObserver, useValue: breakpointObserver },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { items, activeMediaId: 'm1' } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaInspectorDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, mediaService, galleryStore, dialogRef, tagsClient, items, breakpointObserver };
  }

  function setStageBounds(fixture: { nativeElement: HTMLElement }): void {
    const stage = fixture.nativeElement.querySelector('.inspector-media-pane') as HTMLElement | null;
    if (!stage) {
      return;
    }

    stage.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 320,
      height: 480,
      right: 320,
      bottom: 480,
      toJSON: () => ({}),
    }));
  }

  function makePointerEvent(
    target: EventTarget,
    init: {
      pointerId: number;
      clientX: number;
      clientY: number;
      pointerType?: string;
      button?: number;
    },
  ): PointerEvent {
    return {
      target,
      currentTarget: target,
      pointerId: init.pointerId,
      clientX: init.clientX,
      clientY: init.clientY,
      pointerType: init.pointerType ?? 'touch',
      button: init.button ?? 0,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent;
  }

  it('loads media detail and renders metadata, characters, series, tags, and OCR sections', async () => {
    const { fixture, mediaService } = await createComponent();

    expect(mediaService.get).toHaveBeenCalledWith('m1');
    expect(mediaService.getFileUrl).toHaveBeenCalledWith('m1');
    expect(fixture.nativeElement.textContent).toContain('Summary');
    expect(fixture.nativeElement.textContent).toContain('Upload');
    expect(fixture.nativeElement.textContent).toContain('Uploaded at');
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

  it('shows a desktop favorite button and toggles favorites from it', async () => {
    const { fixture, galleryStore } = await createComponent();

    const favoriteButton = fixture.nativeElement.querySelector(
      'button[aria-label="Add to favorites"]',
    ) as HTMLButtonElement | null;
    expect(favoriteButton).not.toBeNull();

    favoriteButton?.click();
    fixture.detectChanges();

    expect(galleryStore.toggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    expect(fixture.componentInstance.isFavorited()).toBe(true);
  });

  it('hides viewer chrome after inactivity and toggles it on surface taps', async () => {
    vi.useFakeTimers();
    const { fixture } = await createComponent();
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;

    expect(fixture.componentInstance.chromeVisible()).toBe(true);

    await vi.advanceTimersByTimeAsync(2600);
    fixture.detectChanges();
    expect(fixture.componentInstance.chromeVisible()).toBe(false);

    fixture.componentInstance.onViewerSurfaceClick({
      target: image,
      preventDefault: vi.fn(),
    } as unknown as Event);
    fixture.detectChanges();
    expect(fixture.componentInstance.chromeVisible()).toBe(true);

    fixture.componentInstance.onViewerSurfaceClick({
      target: image,
      preventDefault: vi.fn(),
    } as unknown as Event);
    fixture.detectChanges();
    expect(fixture.componentInstance.chromeVisible()).toBe(false);
  });

  it('starts with mobile details collapsed and does not render a top details toggle', async () => {
    const { fixture } = await createComponent({ isMobile: true });

    expect(fixture.componentInstance.isMobile()).toBe(true);
    expect(fixture.componentInstance.mobileDetailsOpen()).toBe(false);
    expect(fixture.componentInstance.detailsVisible()).toBe(false);

    const detailsButton = fixture.nativeElement.querySelector(
      '.inspector-overlay--top-right button[aria-expanded]',
    ) as HTMLButtonElement | null;
    const sheetToggle = fixture.nativeElement.querySelector(
      '.inspector-sheet-toggle',
    ) as HTMLButtonElement | null;
    expect(detailsButton).toBeNull();
    expect(sheetToggle?.textContent).toContain('Details');
  });

  it('toggles the current image favorite state on mobile double tap and updates feedback', async () => {
    vi.useFakeTimers();
    const { fixture, galleryStore } = await createComponent({ isMobile: true });
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    setStageBounds(fixture);

    fixture.componentInstance.onViewerSurfaceClick({
      target: image,
      clientX: 144,
      clientY: 188,
      preventDefault: vi.fn(),
    } as unknown as Event);
    await vi.advanceTimersByTimeAsync(120);
    fixture.componentInstance.onViewerSurfaceClick({
      target: image,
      clientX: 144,
      clientY: 188,
      preventDefault: vi.fn(),
    } as unknown as Event);
    fixture.detectChanges();

    expect(galleryStore.toggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    expect(fixture.componentInstance.isFavorited()).toBe(true);
    expect(fixture.componentInstance.favoriteFeedback()).toEqual(
      expect.objectContaining({
        favorited: true,
        x: 144,
        y: 188,
      }),
    );

    await vi.advanceTimersByTimeAsync(720);
    fixture.detectChanges();
    expect(fixture.componentInstance.favoriteFeedback()).toBeNull();

    fixture.componentInstance.onViewerSurfaceClick({
      target: image,
      clientX: 144,
      clientY: 188,
      preventDefault: vi.fn(),
    } as unknown as Event);
    await vi.advanceTimersByTimeAsync(120);
    fixture.componentInstance.onViewerSurfaceClick({
      target: image,
      clientX: 144,
      clientY: 188,
      preventDefault: vi.fn(),
    } as unknown as Event);
    fixture.detectChanges();

    expect(galleryStore.toggleFavorite).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.isFavorited()).toBe(false);
    expect(fixture.componentInstance.favoriteFeedback()).toEqual(
      expect.objectContaining({
        favorited: false,
        x: 144,
        y: 188,
      }),
    );
  });

  it('fully hides the collapsed mobile sheet when viewer chrome is hidden', async () => {
    const { fixture } = await createComponent({ isMobile: true });

    fixture.componentInstance.chromeVisible.set(false);
    fixture.detectChanges();

    const sidebar = fixture.nativeElement.querySelector('.inspector-sidebar') as HTMLElement | null;
    expect(sidebar?.classList.contains('inspector-sidebar--chrome-hidden')).toBe(true);
  });

  it('opens the mobile details sheet when editing begins', async () => {
    const { fixture } = await createComponent({ isMobile: true });

    fixture.componentInstance.beginEdit();
    fixture.detectChanges();

    const sidebar = fixture.nativeElement.querySelector('.inspector-sidebar') as HTMLElement | null;
    expect(fixture.componentInstance.editing()).toBe(true);
    expect(fixture.componentInstance.mobileDetailsOpen()).toBe(true);
    expect(sidebar?.classList.contains('inspector-sidebar--open')).toBe(true);
  });

  it('opens the mobile details sheet on swipe up and collapses it on swipe down', async () => {
    const { fixture } = await createComponent({ isMobile: true });
    const handle = fixture.nativeElement.querySelector(
      '.inspector-sheet-toggle',
    ) as HTMLButtonElement;

    fixture.componentInstance.onSheetHandlePointerDown(
      makePointerEvent(handle, { pointerId: 70, clientX: 120, clientY: 400 }),
    );
    fixture.componentInstance.stopPointerInteraction(
      makePointerEvent(handle, { pointerId: 70, clientX: 118, clientY: 320 }),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.mobileDetailsOpen()).toBe(true);

    fixture.componentInstance.onSheetHandlePointerDown(
      makePointerEvent(handle, { pointerId: 71, clientX: 120, clientY: 240 }),
    );
    fixture.componentInstance.stopPointerInteraction(
      makePointerEvent(handle, { pointerId: 71, clientX: 122, clientY: 330 }),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.mobileDetailsOpen()).toBe(false);
  });

  it('accepts touch sheet gestures even when the pointer button is not reported as primary', async () => {
    const { fixture } = await createComponent({ isMobile: true });
    const handle = fixture.nativeElement.querySelector(
      '.inspector-sheet-toggle',
    ) as HTMLButtonElement;

    fixture.componentInstance.onSheetHandlePointerDown(
      makePointerEvent(handle, {
        pointerId: 72,
        clientX: 120,
        clientY: 400,
        pointerType: 'touch',
        button: -1,
      }),
    );
    fixture.componentInstance.stopPointerInteraction(
      makePointerEvent(handle, {
        pointerId: 72,
        clientX: 118,
        clientY: 320,
        pointerType: 'touch',
        button: -1,
      }),
    );

    expect(fixture.componentInstance.mobileDetailsOpen()).toBe(true);
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

  it('emits the active media id when navigating between items', async () => {
    const { fixture } = await createComponent();
    const changedIds: string[] = [];
    fixture.componentInstance.activeMediaChanged.subscribe((id) => changedIds.push(id));

    fixture.componentInstance.next();
    fixture.detectChanges();

    expect(changedIds).toEqual(['m2']);
  });

  it('supports keyboard navigation and escape close', async () => {
    const { fixture, dialogRef } = await createComponent();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.activeIndex()).toBe(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('swipes left and right between items at base zoom', async () => {
    const { fixture } = await createComponent();
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;

    setStageBounds(fixture);

    fixture.componentInstance.onStagePointerDown(
      makePointerEvent(image, { pointerId: 1, clientX: 240, clientY: 140 }),
    );
    fixture.componentInstance.stopPointerInteraction(
      makePointerEvent(image, { pointerId: 1, clientX: 120, clientY: 150 }),
    );

    expect(fixture.componentInstance.activeIndex()).toBe(1);

    fixture.componentInstance.onStagePointerDown(
      makePointerEvent(image, { pointerId: 2, clientX: 120, clientY: 150 }),
    );
    fixture.componentInstance.stopPointerInteraction(
      makePointerEvent(image, { pointerId: 2, clientX: 240, clientY: 145 }),
    );

    expect(fixture.componentInstance.activeIndex()).toBe(0);
  });

  it('ignores swipe navigation when zoomed in and pans instead', async () => {
    const { fixture } = await createComponent();
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;

    setStageBounds(fixture);
    fixture.componentInstance['zoom'].set(2);

    fixture.componentInstance.onStagePointerDown(
      makePointerEvent(image, { pointerId: 1, clientX: 220, clientY: 140 }),
    );
    fixture.componentInstance.onPointerMove(
      makePointerEvent(image, { pointerId: 1, clientX: 70, clientY: 140 }),
    );
    fixture.componentInstance.stopPointerInteraction(
      makePointerEvent(image, { pointerId: 1, clientX: 70, clientY: 140 }),
    );

    expect(fixture.componentInstance.activeIndex()).toBe(0);
    expect(fixture.componentInstance.panX()).toBeLessThan(0);
  });

  it('pinches to zoom and clamps the maximum zoom level', async () => {
    const { fixture } = await createComponent();
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;

    setStageBounds(fixture);

    fixture.componentInstance.onStagePointerDown(
      makePointerEvent(image, { pointerId: 1, clientX: 120, clientY: 140 }),
    );
    fixture.componentInstance.onStagePointerDown(
      makePointerEvent(image, { pointerId: 2, clientX: 200, clientY: 140 }),
    );
    fixture.componentInstance.onPointerMove(
      makePointerEvent(image, { pointerId: 2, clientX: 320, clientY: 140 }),
    );

    expect(fixture.componentInstance.zoom()).toBeGreaterThan(1);

    fixture.componentInstance.onPointerMove(
      makePointerEvent(image, { pointerId: 2, clientX: 2200, clientY: 140 }),
    );

    expect(fixture.componentInstance.zoom()).toBe(6);
  });

  it('resets zoom when navigating between items', async () => {
    const { fixture } = await createComponent();
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;

    setStageBounds(fixture);
    fixture.componentInstance.onStagePointerDown(
      makePointerEvent(image, { pointerId: 1, clientX: 120, clientY: 140 }),
    );
    fixture.componentInstance.onStagePointerDown(
      makePointerEvent(image, { pointerId: 2, clientX: 200, clientY: 140 }),
    );
    fixture.componentInstance.onPointerMove(
      makePointerEvent(image, { pointerId: 2, clientX: 320, clientY: 140 }),
    );
    fixture.componentInstance['panX'].set(24);
    fixture.componentInstance['panY'].set(12);

    fixture.componentInstance.next();

    expect(fixture.componentInstance.zoom()).toBe(1);
    expect(fixture.componentInstance.panX()).toBe(0);
    expect(fixture.componentInstance.panY()).toBe(0);
    expect(fixture.componentInstance.dragging()).toBe(false);
  });

  it('builds the combined save payload, clears empty values, and patches gallery state', async () => {
    const updated = makeDetail('m1', {
      tags: ['hero'],
      is_nsfw_override: null,
      is_sensitive_override: null,
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
      is_nsfw_override: null,
      is_sensitive_override: null,
      version: 1,
    });
    expect(galleryStore.patchItem).toHaveBeenCalledWith(updated);
    expect(fixture.componentInstance.editing()).toBe(false);
  });

  it('preserves apostrophes when manually adding a missing character name', async () => {
    const update = vi.fn(() =>
      of(
        makeDetail('m1', {
          entities: [
            {
              id: 'entity-3',
              entity_type: MediaEntityType.CHARACTER,
              entity_id: null,
              name: "Jeanne D'Arc (Fate)",
              role: 'primary',
              source: 'manual',
              confidence: null,
            },
          ],
        }),
      ),
    );
    const { fixture, mediaService } = await createComponent({
      get: vi.fn(() =>
        of(
          makeDetail('m1', {
            entities: [],
          }),
        ),
      ),
      update,
    });

    fixture.componentInstance.beginEdit();
    fixture.componentInstance.characterInputControl.setValue("  Jeanne D'Arc (Fate)  ");
    fixture.componentInstance.addTypedCharacter();
    fixture.componentInstance.save();
    await fixture.whenStable();

    expect(mediaService.update).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({
        entities: [{ entity_type: MediaEntityType.CHARACTER, name: "Jeanne D'Arc (Fate)" }],
      }),
    );
  });

  it('renders content safety controls in edit mode and saves manual overrides', async () => {
    const updated = makeDetail('m1', {
      is_nsfw: true,
      is_sensitive: false,
      is_nsfw_override: true,
      is_sensitive_override: false,
      version: 2,
    });
    const update = vi.fn(() => of(updated));
    const { fixture, mediaService, galleryStore } = await createComponent({
      get: vi.fn(() =>
        of(
          makeDetail('m1', {
            is_nsfw: false,
            is_sensitive: true,
            is_nsfw_override: null,
            is_sensitive_override: true,
          }),
        ),
      ),
      update,
    });

    fixture.componentInstance.beginEdit();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Content Safety');
    expect(fixture.nativeElement.textContent).toContain('NSFW classification');
    expect(fixture.nativeElement.textContent).toContain('Sensitive classification');
    expect(fixture.componentInstance['draft']().nsfwOverride).toBeNull();
    expect(fixture.componentInstance['draft']().sensitiveOverride).toBe(true);

    fixture.componentInstance.updateNsfwOverride(true);
    fixture.componentInstance.updateSensitiveOverride(false);
    fixture.componentInstance.save();
    await fixture.whenStable();

    expect(mediaService.update).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({
        is_nsfw_override: true,
        is_sensitive_override: false,
        version: 1,
      }),
    );
    expect(galleryStore.patchItem).toHaveBeenCalledWith(updated);
  });

  it('clears manual classification overrides when automatic is selected', async () => {
    const { fixture, mediaService } = await createComponent({
      get: vi.fn(() =>
        of(
          makeDetail('m1', {
            is_nsfw_override: true,
            is_sensitive_override: false,
          }),
        ),
      ),
    });

    fixture.componentInstance.beginEdit();
    fixture.componentInstance.updateNsfwOverride(null);
    fixture.componentInstance.updateSensitiveOverride(null);
    fixture.componentInstance.save();
    await fixture.whenStable();

    expect(mediaService.update).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({
        is_nsfw_override: null,
        is_sensitive_override: null,
      }),
    );
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
