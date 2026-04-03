import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlbumStore } from '../../services/album.store';
import { MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../models/media';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { GalleryStore } from '../../services/gallery.store';
import { UploadTrackerService } from '../../services/upload-tracker.service';
import { DayGroup } from '../../utils/gallery-grouping.utils';
import { MediaBrowserComponent } from './media-browser.component';
import { MediaService } from '../../services/media.service';
import { MediaClientService } from '../../services/web/media-client.service';
import { MediaInspectorDialogComponent } from './media-inspector-dialog/media-inspector-dialog.component';

function makeMedia(id: string, width: number, height: number) {
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
      width,
      height,
      duration_seconds: null,
      frame_count: null,
      mime_type: 'image/jpeg',
      captured_at: '2026-03-28T12:00:00Z',
    },
    version: 1,
    created_at: '2026-03-28T12:00:00Z',
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

const galleryStoreMock = {
  batchDelete: vi.fn(() => of({ processed: 1, skipped: 0 })),
  batchQueueTaggingJobs: vi.fn(() => of({ queued: 1 })),
  batchUpdateVisibility: vi.fn(() => of({ processed: 1, skipped: 0 })),
  hasMore: vi.fn(() => true),
  toggleFavorite: vi.fn((media) => of({ ...media, is_favorited: !media.is_favorited })),
};

const albumStoreMock = {
  addMedia: vi.fn(() => of({ processed: 1, skipped: 0 })),
  items: () => [],
  loading: () => false,
  loaded: () => true,
  load: vi.fn(() => of([])),
};

const confirmDialogMock = {
  open: vi.fn(() => of(true)),
};

const dialogMock = {
  open: vi.fn(() => ({ afterClosed: () => of(undefined as unknown) })),
};

const uploadTrackerMock = {
  registerRetagging: vi.fn(),
};

async function configureBrowserTestingModule() {
  await TestBed.configureTestingModule({
    imports: [MediaBrowserComponent],
    providers: [
      provideRouter([]),
      {
        provide: MediaService,
        useValue: {
          getThumbnailUrl: () => of('blob:thumb'),
          getPosterUrl: () => of('blob:poster'),
          getFileUrl: () => of('blob:file'),
        },
      },
      {
        provide: MediaClientService,
        useValue: {
          search: () => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 100 }),
          batchUpdate: vi.fn(() => of({ processed: 1, skipped: 0 })),
        },
      },
      { provide: AlbumStore, useValue: albumStoreMock },
      { provide: MatDialog, useValue: dialogMock },
      { provide: GalleryStore, useValue: galleryStoreMock },
      { provide: ConfirmDialogService, useValue: confirmDialogMock },
      { provide: UploadTrackerService, useValue: uploadTrackerMock },
    ],
  }).compileComponents();
}

describe('MediaBrowserComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    galleryStoreMock.batchDelete.mockClear();
    galleryStoreMock.batchQueueTaggingJobs.mockClear();
    galleryStoreMock.batchUpdateVisibility.mockClear();
    galleryStoreMock.hasMore.mockClear();
    galleryStoreMock.toggleFavorite.mockClear();
    albumStoreMock.addMedia.mockClear();
    albumStoreMock.load.mockClear();
    confirmDialogMock.open.mockClear();
    dialogMock.open.mockClear();
    uploadTrackerMock.registerRetagging.mockClear();
  });

  it('renders skeleton sections for timeline months not in dayGroups', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      { date: '2026-03-28', label: 'March 28, 2026', items: [] },
    ] satisfies DayGroup[]);
    fixture.componentRef.setInput('timeline', [
      { year: 2026, month: 3, count: 3 },
      { year: 2026, month: 2, count: 5 },
      { year: 2026, month: 1, count: 2 },
    ]);
    fixture.detectChanges();

    const sections = fixture.nativeElement.querySelectorAll('.media-browser__day');
    const skeletons = fixture.nativeElement.querySelectorAll('.media-browser__day--skeleton');
    expect(sections.length).toBe(3);
    expect(skeletons.length).toBe(2);
  });

  it('skeleton sections contain the expected number of placeholder cells', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', []);
    fixture.componentRef.setInput('timeline', [{ year: 2026, month: 3, count: 4 }]);
    fixture.componentInstance.contentWidth.set(960);
    fixture.detectChanges();

    const skeletonCards = fixture.nativeElement.querySelectorAll('.media-browser__skeleton-card');
    expect(skeletonCards.length).toBe(4);
  });

  it('does not show empty state when timeline has buckets but dayGroups is empty', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', []);
    fixture.componentRef.setInput('timeline', [{ year: 2026, month: 3, count: 2 }]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.media-browser__empty')).toBeNull();
    expect(fixture.nativeElement.querySelector('.media-browser__day--skeleton')).not.toBeNull();
  });

  it('shows empty state when both timeline and dayGroups are empty', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', []);
    fixture.componentRef.setInput('timeline', []);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.media-page__empty')).not.toBeNull();
  });

  it('renders stories inside the scrollable browser content when enabled', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('showStories', true);
    fixture.componentRef.setInput('storyParams', {
      captured_month: 4,
      captured_day: 2,
      captured_before_year: 2026,
    });
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m1', 1600, 900)],
      },
    ] satisfies DayGroup[]);
    fixture.componentRef.setInput('timeline', [{ year: 2026, month: 3, count: 1 }]);
    fixture.detectChanges();

    const content = fixture.nativeElement.querySelector('.media-browser__content') as HTMLElement;
    const storiesRail = content.querySelector('zukan-today-stories-rail');
    const browserHost = fixture.nativeElement.querySelector(':scope > zukan-today-stories-rail');

    expect(storiesRail).not.toBeNull();
    expect(browserHost).toBeNull();
    expect(content.firstElementChild?.tagName.toLowerCase()).toBe('zukan-today-stories-rail');
  });

  it('renders custom empty-state copy when provided', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', []);
    fixture.componentRef.setInput('timeline', []);
    fixture.componentRef.setInput('emptyStateTitle', 'Trash is empty');
    fixture.componentRef.setInput('emptyStateMessage', 'Deleted media will appear here.');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Trash is empty');
    expect(fixture.nativeElement.textContent).toContain('Deleted media will appear here.');
  });

  it('hides selection controls in read-only mode', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('allowSelection', false);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m1', 1600, 900)],
      },
    ] satisfies DayGroup[]);
    fixture.componentRef.setInput('timeline', [{ year: 2026, month: 3, count: 1 }]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.media-browser__action-bar')).toBeNull();
    expect(fixture.nativeElement.querySelector('.media-browser__day-selection-button')).toBeNull();
  });

  it('scrolls directly to a skeleton section when jumping to an unloaded month', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      { date: '2026-03-28', label: 'March 28, 2026', items: [] },
      { date: '2026-01-10', label: 'January 10, 2026', items: [] },
    ] satisfies DayGroup[]);
    fixture.componentRef.setInput('timeline', [
      { year: 2026, month: 3, count: 3 },
      { year: 2026, month: 2, count: 2 },
      { year: 2026, month: 1, count: 4 },
    ]);
    fixture.detectChanges();

    const content = fixture.nativeElement.querySelector('.media-browser__content') as HTMLElement;
    Object.defineProperty(content, 'scrollTop', { value: 0, writable: true });
    Object.defineProperty(content, 'scrollTo', { value: vi.fn(), writable: true });
    Object.defineProperty(content, 'getBoundingClientRect', {
      value: () => ({ top: 0, left: 0, bottom: 500, right: 500, width: 500, height: 500 }),
    });

    fixture.componentInstance.onJumpRequested('2026-02');

    expect(content.scrollTo).toHaveBeenCalled();
  });

  it('tracks the active month all the way to the bottom of the loaded range', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      { date: '2026-09-12', label: 'September 12, 2026', items: [] },
      { date: '2025-09-10', label: 'September 10, 2025', items: [] },
      { date: '2024-06-15', label: 'June 15, 2024', items: [] },
    ] satisfies DayGroup[]);
    fixture.componentRef.setInput('timeline', [
      { year: 2026, month: 9, count: 2 },
      { year: 2025, month: 9, count: 2 },
      { year: 2024, month: 6, count: 2 },
    ]);
    fixture.detectChanges();

    const content = fixture.nativeElement.querySelector('.media-browser__content') as HTMLElement;
    Object.defineProperty(content, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(content, 'scrollHeight', { value: 1400, configurable: true });
    Object.defineProperty(content, 'scrollTop', {
      value: 1000,
      writable: true,
      configurable: true,
    });
    fixture.componentInstance.onContentScroll();
    (fixture.componentInstance as any).syncActiveSection();

    expect(fixture.componentInstance.activeMonthKey()).toBe('2024-06');
    expect(fixture.componentInstance.activeTimelineProgress()).toBe(100);
  });

  it('packs media into justified rows', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [
          makeMedia('m1', 1600, 900),
          makeMedia('m2', 700, 1000),
          makeMedia('m3', 1300, 900),
          makeMedia('m4', 900, 900),
        ],
      },
    ] satisfies DayGroup[]);
    fixture.componentRef.setInput('timeline', []);
    fixture.componentInstance.contentWidth.set(960);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.media-browser__row');
    expect(rows.length).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelector('.media-browser__grid')).toBeNull();
    expect(fixture.componentInstance.justifiedMonthGroups()[0]?.days[0]?.rows.length).toBeGreaterThan(0);
  });

  it('switches to compact row sizing on narrow content widths', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m1', 1600, 900), makeMedia('m2', 700, 1000), makeMedia('m3', 1300, 900)],
      },
    ] satisfies DayGroup[]);
    fixture.componentRef.setInput('timeline', []);
    fixture.componentInstance.contentWidth.set(390);
    fixture.detectChanges();

    expect(fixture.componentInstance.isCompactLayout()).toBe(true);
    expect(fixture.componentInstance.justifiedMonthGroups()[0]?.days[0]?.rows[0]?.height).toBeLessThanOrEqual(
      260,
    );
  });

  it('enters selection mode when a media card is selected', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m1', 100, 100)],
      },
    ] satisfies DayGroup[]);
    fixture.detectChanges();

    fixture.componentInstance.onMediaSelectionToggled(makeMedia('m1', 100, 100));
    fixture.detectChanges();

    expect(fixture.componentInstance.isSelectionMode()).toBe(true);
    expect(fixture.componentInstance.selectionCount()).toBe(1);
    expect(fixture.nativeElement.querySelector('.media-browser__action-bar')).not.toBeNull();
  });

  it('toggles favorites through the gallery store', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    const media = makeMedia('m1', 100, 100);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [media],
      },
    ] satisfies DayGroup[]);
    fixture.detectChanges();

    fixture.componentInstance.onFavoriteToggled(media);

    expect(galleryStoreMock.toggleFavorite).toHaveBeenCalledWith(media);
  });

  it('opens the inspector dialog when a media card is activated', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    const media = makeMedia('m1', 100, 100);
    const secondMedia = makeMedia('m2', 120, 120);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [media, secondMedia],
      },
    ] satisfies DayGroup[]);
    fixture.detectChanges();

    fixture.componentInstance.onMediaActivated(media);

    expect(dialogMock.open).toHaveBeenCalledWith(
      MediaInspectorDialogComponent,
      expect.objectContaining({
        data: { items: [media, secondMedia], activeMediaId: media.id },
        width: '100vw',
        maxWidth: '100vw',
        height: '100vh',
        panelClass: 'media-inspector-dialog-panel',
      }),
    );
  });

  it('keeps click behavior in selection mode on selection toggle instead of opening the inspector', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    const media = makeMedia('m1', 100, 100);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [media],
      },
    ] satisfies DayGroup[]);
    fixture.detectChanges();

    fixture.componentInstance.onMediaSelectionToggled(media);

    expect(fixture.componentInstance.selectionCount()).toBe(1);
    expect(dialogMock.open).not.toHaveBeenCalledWith(
      MediaInspectorDialogComponent,
      expect.anything(),
    );
  });

  it('shows restore-only actions in trash mode', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('selectionActionMode', 'trash');
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m1', 100, 100)],
      },
    ] satisfies DayGroup[]);
    fixture.detectChanges();

    fixture.componentInstance.onMediaSelectionToggled(makeMedia('m1', 100, 100));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Restore selected');
    expect(text).not.toContain('Reprocess tagging');
    expect(text).not.toContain('Make public');
  });

  it('emits selected ids when restore is requested', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    const restoreSpy = vi.fn();
    fixture.componentInstance.restoreSelected.subscribe(restoreSpy);
    fixture.componentRef.setInput('selectionActionMode', 'trash');
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m1', 100, 100)],
      },
    ] satisfies DayGroup[]);
    fixture.detectChanges();

    fixture.componentInstance.onMediaSelectionToggled(makeMedia('m1', 100, 100));
    fixture.componentInstance.requestRestoreSelection();

    expect(restoreSpy).toHaveBeenCalledWith(['m1']);
  });

  it('adds the selected media to an existing album from the action bar', async () => {
    dialogMock.open.mockReturnValueOnce({
      afterClosed: () => of({ albumId: 'album-1', albumName: 'Favorites' }),
    });
    albumStoreMock.addMedia.mockReturnValueOnce(of({ processed: 1, skipped: 0 }));

    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m1', 100, 100)],
      },
    ] satisfies DayGroup[]);
    fixture.detectChanges();
    fixture.componentInstance.onMediaSelectionToggled(makeMedia('m1', 100, 100));
    fixture.detectChanges();

    fixture.componentInstance.addSelectionToAlbum();

    expect(dialogMock.open).toHaveBeenCalledTimes(1);
    expect(albumStoreMock.addMedia).toHaveBeenCalledWith('album-1', ['m1']);
    expect(fixture.componentInstance.selectionCount()).toBe(0);
  });

  it('selects a full day group from the header control', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m1', 100, 100), makeMedia('m2', 100, 100)],
      },
    ] satisfies DayGroup[]);
    fixture.componentRef.setInput('timeline', []);
    fixture.detectChanges();

    const justifiedGroup = fixture.componentInstance.justifiedMonthGroups()[0]!.days[0]!;
    fixture.componentInstance.toggleDaySelection(justifiedGroup);

    expect(fixture.componentInstance.selectionCount()).toBe(2);
    expect(fixture.componentInstance.isDaySelected(justifiedGroup)).toBe(true);
  });

  it('selects all loaded media on Ctrl+A', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m1', 100, 100), makeMedia('m2', 100, 100)],
      },
    ] satisfies DayGroup[]);
    fixture.detectChanges();

    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true });
    fixture.componentInstance.onDocumentKeydown(event);

    expect(fixture.componentInstance.selectionCount()).toBe(2);
    expect(fixture.componentInstance.isAllSelected()).toBe(true);
  });

  it('clears the selection on Escape', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m1', 100, 100)],
      },
    ] satisfies DayGroup[]);
    fixture.detectChanges();
    fixture.componentInstance.onMediaSelectionToggled(makeMedia('m1', 100, 100));

    fixture.componentInstance.onDocumentKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(fixture.componentInstance.selectionCount()).toBe(0);
    expect(fixture.componentInstance.isSelectionMode()).toBe(false);
  });

  it('reconciles selection when media changes', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m1', 100, 100), makeMedia('m2', 100, 100)],
      },
    ] satisfies DayGroup[]);
    fixture.componentRef.setInput('timeline', []);
    fixture.detectChanges();

    const justifiedGroup = fixture.componentInstance.justifiedMonthGroups()[0]!.days[0]!;
    fixture.componentInstance.toggleDaySelection(justifiedGroup);
    fixture.detectChanges();

    fixture.componentRef.setInput('dayGroups', [
      {
        date: '2026-03-28',
        label: 'March 28, 2026',
        items: [makeMedia('m2', 100, 100)],
      },
    ] satisfies DayGroup[]);
    fixture.detectChanges();
    await Promise.resolve();

    expect(fixture.componentInstance.selectionCount()).toBe(1);
    expect(fixture.componentInstance.isMediaSelected('m2')).toBe(true);
  });
});
