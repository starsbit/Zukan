import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
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
import { MediaInspectionContextService } from '../../services/media-inspection-context.service';

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

const galleryStoreMock = {
  batchDelete: vi.fn(() => of({ processed: 1, skipped: 0 })),
  batchUpdateAnnotations: vi.fn(() => of({ processed: 1, skipped: 0 })),
  batchQueueTaggingJobs: vi.fn(() => of({ queued: 1 })),
  batchUpdateVisibility: vi.fn(() => of({ processed: 1, skipped: 0 })),
  hasMore: vi.fn(() => true),
  monthMap: vi.fn(() => new Map()),
  ensureMonthWindow: vi.fn(() => of(null)),
  loadMoreForMonth: vi.fn(() => of({ items: [], total: null, next_cursor: null, has_more: false, page_size: 160 })),
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

function makeDialogRefMock(overrides?: {
  afterClosed?: () => Observable<unknown>;
  close?: ReturnType<typeof vi.fn>;
  activeMediaChanged?: Subject<string>;
  metadataFilterSelected?: Subject<{ type: 'tag' | 'character' | 'series'; value: string }>;
}) {
  return {
    afterClosed: overrides?.afterClosed ?? (() => of(undefined as unknown)),
    close: overrides?.close ?? vi.fn(),
    componentInstance: {
      activeMediaChanged: overrides?.activeMediaChanged ?? new Subject<string>(),
      metadataFilterSelected: overrides?.metadataFilterSelected ?? new Subject<{ type: 'tag' | 'character' | 'series'; value: string }>(),
    },
  };
}

const dialogMock = {
  open: vi.fn(() => makeDialogRefMock()),
};

const uploadTrackerMock = {
  registerRetagging: vi.fn(),
};

const mediaServiceMock = {
  get: vi.fn((id: string) => of(makeMedia(id, 100, 100))),
  getThumbnailUrl: () => of('blob:thumb'),
  getPosterUrl: () => of('blob:poster'),
  getFileUrl: () => of('blob:file'),
};

const sharedProviders = [
  {
    provide: MediaService,
    useValue: mediaServiceMock,
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
];

async function configureBrowserTestingModule() {
  await TestBed.configureTestingModule({
    imports: [MediaBrowserComponent],
    providers: [provideRouter([]), ...sharedProviders],
  }).compileComponents();
}

function setWindowScrollY(value: number): void {
  Object.defineProperty(window, 'scrollY', {
    value,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, 'scrollTop', {
    value,
    writable: true,
    configurable: true,
  });
}

function setWindowInnerHeight(value: number): void {
  Object.defineProperty(window, 'innerHeight', {
    value,
    writable: true,
    configurable: true,
  });
}

function placeContentAtDocumentTop(content: HTMLElement, top = 0): void {
  Object.defineProperty(content, 'getBoundingClientRect', {
    value: () => ({
      top: top - window.scrollY,
      left: 0,
      bottom: top - window.scrollY + 500,
      right: 500,
      width: 500,
      height: 500,
    }),
    configurable: true,
  });
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
    setWindowScrollY(0);
    setWindowInnerHeight(900);
    galleryStoreMock.batchDelete.mockClear();
    galleryStoreMock.batchUpdateAnnotations.mockClear();
    galleryStoreMock.batchQueueTaggingJobs.mockClear();
    galleryStoreMock.batchUpdateVisibility.mockClear();
    galleryStoreMock.hasMore.mockClear();
    galleryStoreMock.monthMap.mockClear();
    galleryStoreMock.ensureMonthWindow.mockClear();
    galleryStoreMock.loadMoreForMonth.mockClear();
    galleryStoreMock.toggleFavorite.mockClear();
    mediaServiceMock.get.mockClear();
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
    expect(fixture.nativeElement.querySelectorAll('.media-browser__skeleton-spinner').length).toBe(4);
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

  it('renders stories inside the browser content when enabled', async () => {
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

    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const content = fixture.nativeElement.querySelector('.media-browser__content') as HTMLElement;
    Object.defineProperty(content, 'getBoundingClientRect', {
      value: () => ({ top: 0, left: 0, bottom: 500, right: 500, width: 500, height: 500 }),
    });

    fixture.componentInstance.onJumpRequested('2026-02');

    expect(scrollToSpy).toHaveBeenCalled();
  });

  it('scrolls directly to a rendered section when jumping to a loaded month', async () => {
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

    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const content = fixture.nativeElement.querySelector('.media-browser__content') as HTMLElement;
    Object.defineProperty(content, 'getBoundingClientRect', {
      value: () => ({ top: 0, left: 0, bottom: 500, right: 500, width: 500, height: 500 }),
    });

    fixture.componentInstance.onJumpRequested('2026-03');

    expect(scrollToSpy).toHaveBeenCalled();
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
    placeContentAtDocumentTop(content);
    setWindowInnerHeight(400);
    setWindowScrollY(1000);
    fixture.componentInstance.monthMetrics.set([
      { key: '2026-09', year: 2026, month: 9, offset: 0, height: 320 },
      { key: '2025-09', year: 2025, month: 9, offset: 420, height: 320 },
      { key: '2024-06', year: 2024, month: 6, offset: 1000, height: 320 },
    ]);
    fixture.componentInstance.maxScrollTop.set(1000);
    (fixture.componentInstance as any).syncActiveSection();

    expect(fixture.componentInstance.activeMonthKey()).toBe('2024-06');
    expect(fixture.componentInstance.activeTimelineProgress()).toBe(100);
  });

  it('uses cached month metrics when syncing the active section', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      { date: '2026-03-28', label: 'March 28, 2026', items: [] },
      { date: '2026-02-10', label: 'February 10, 2026', items: [] },
    ] satisfies DayGroup[]);
    fixture.componentRef.setInput('timeline', [
      { year: 2026, month: 3, count: 3 },
      { year: 2026, month: 2, count: 2 },
    ]);
    fixture.detectChanges();

    const content = fixture.nativeElement.querySelector('.media-browser__content') as HTMLElement;
    placeContentAtDocumentTop(content);
    setWindowScrollY(260);
    (fixture.componentInstance as any).measuredMonthHeights.set({
      '2026-03': 250,
      '2026-02': 300,
    });
    fixture.componentInstance.maxScrollTop.set(500);

    const measureOffsetSpy = vi.spyOn(
      fixture.componentInstance as unknown as { measureOffsetWithinContent: () => number },
      'measureOffsetWithinContent',
    );

    (fixture.componentInstance as any).syncActiveSection();

    expect(measureOffsetSpy).not.toHaveBeenCalled();
    expect(fixture.componentInstance.activeMonthKey()).toBe('2026-02');
    expect(fixture.componentInstance.activeYear()).toBe(2026);
  });

  it('positions timeline months from measured scroll offsets when available', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    fixture.componentRef.setInput('dayGroups', [
      { date: '2026-03-28', label: 'March 28, 2026', items: [] },
      { date: '2026-02-10', label: 'February 10, 2026', items: [] },
      { date: '2026-01-10', label: 'January 10, 2026', items: [] },
    ] satisfies DayGroup[]);
    fixture.componentRef.setInput('timeline', [
      { year: 2026, month: 3, count: 3 },
      { year: 2026, month: 2, count: 2 },
      { year: 2026, month: 1, count: 4 },
    ]);
    fixture.detectChanges();

    (fixture.componentInstance as any).measuredMonthHeights.set({
      '2026-03': 250,
      '2026-02': 250,
      '2026-01': 250,
    });
    fixture.componentInstance.maxScrollTop.set(500);

    const months = fixture.componentInstance.timelineEntries()[0]?.months ?? [];
    expect(months.map((month) => month.position)).toEqual([0, 50, 100]);
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

  it('treats tablet-sized content widths as compact to avoid oversized mobile rows', async () => {
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
    fixture.componentInstance.contentWidth.set(900);
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

  it('navigates to the media page and records the current list context when a media card is activated', async () => {
    await configureBrowserTestingModule();

    const fixture = TestBed.createComponent(MediaBrowserComponent);
    const router = TestBed.inject(Router);
    const inspectionContext = TestBed.inject(MediaInspectionContextService);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const media = makeMedia('m1', 100, 100);
    const second = makeMedia('m2', 100, 100);
    fixture.componentRef.setInput('dayGroups', [
      { date: '2026-03-28', label: 'March 28, 2026', items: [media, second] },
    ] satisfies DayGroup[]);
    fixture.detectChanges();

    fixture.componentInstance.onMediaActivated(media);

    expect(inspectionContext.items()).toEqual([media, second]);
    expect(inspectionContext.originUrl()).toBe(router.url);
    expect(navigateSpy).toHaveBeenCalledWith(['/media', 'm1']);
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
    expect(dialogMock.open).not.toHaveBeenCalled();
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
    expect(text).toContain('restore_from_trash');
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
    dialogMock.open.mockReturnValueOnce(
      makeDialogRefMock({
        afterClosed: () => of({ albumId: 'album-1', albumName: 'Favorites' } as unknown),
      }),
    );
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

  it('edits metadata for the selected media from the action bar', async () => {
    const dialogValue = {
      add_tags: ['safe'],
      remove_tags: ['old'],
      add_character_names: ['Saber'],
      remove_character_names: [],
      add_series_names: [],
      remove_series_names: [],
    };
    dialogMock.open.mockReturnValueOnce(
      makeDialogRefMock({
        afterClosed: () => of(dialogValue as unknown),
      }),
    );
    galleryStoreMock.batchUpdateAnnotations.mockReturnValueOnce(of({ processed: 1, skipped: 0 }));

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

    fixture.componentInstance.editSelectionMetadata();

    expect(galleryStoreMock.batchUpdateAnnotations).toHaveBeenCalledWith({
      media_ids: ['m1'],
      ...dialogValue,
    });
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
