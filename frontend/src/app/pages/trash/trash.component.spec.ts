import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MediaListState } from '../../models/media';
import { AlbumStore } from '../../services/album.store';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { GalleryStore } from '../../services/gallery.store';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { UploadTrackerService } from '../../services/upload-tracker.service';
import { MediaService } from '../../services/media.service';
import { MediaClientService } from '../../services/web/media-client.service';
import { TagsClientService } from '../../services/web/tags-client.service';
import { AuthStore } from '../../services/web/auth.store';
import { ThemeService } from '../../services/theme.service';
import { TrashComponent } from './trash.component';

describe('TrashComponent', () => {
  const galleryStore = {
    setParams: vi.fn(),
    load: vi.fn(() => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 })),
    loadTimeline: vi.fn(() => of({ buckets: [] })),
    loadMore: vi.fn(() => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 })),
    hasMore: () => false,
    loading: () => false,
    groupedByDay: () => [],
    timeline: () => [],
    items: () => [{ id: 'm1' }],
    total: () => 1,
    batchRestore: vi.fn(() => of({ processed: 1, skipped: 0 })),
    restoreAllTrashed: vi.fn(() => of({ processed: 3, skipped: 0 })),
    emptyTrash: vi.fn(() => of(void 0)),
  };
  const confirmDialog = {
    open: vi.fn(() => of(true)),
  };
  const snackBar = {
    open: vi.fn(),
  };
  const searchService = {
    draftText: () => '',
    draftChips: () => [],
    applied: () => ({
      tags: [],
      characterName: null,
      ocrText: 'test text',
      advanced: {
        excludeTags: [],
        mode: null,
        nsfw: null,
        status: null,
        favorited: null,
        visibility: null,
        mediaTypes: [],
        sortBy: null,
        sortOrder: null,
        capturedYear: null,
        capturedMonth: null,
        capturedDay: null,
        capturedAfter: null,
        capturedBefore: null,
        capturedBeforeYear: null,
      },
    }),
    advancedFilters: () => ({
      excludeTags: [],
      mode: null,
      nsfw: null,
      status: null,
      favorited: null,
      visibility: null,
      mediaTypes: [],
      sortBy: null,
      sortOrder: null,
      capturedYear: null,
      capturedMonth: null,
      capturedDay: null,
      capturedAfter: null,
      capturedBefore: null,
      capturedBeforeYear: null,
    }),
    activeAdvancedFilterCount: () => 0,
    appliedParams: () => ({ ocr_text: 'test text' }),
    setText: vi.fn(),
    addTag: vi.fn(),
    setCharacter: vi.fn(),
    setOcr: vi.fn(),
    setAdvancedFilters: vi.fn(),
    removeChip: vi.fn(),
    removeLastChip: vi.fn(),
    apply: vi.fn(),
    clear: vi.fn(),
  };

  beforeEach(() => {
    galleryStore.setParams.mockClear();
    galleryStore.load.mockClear();
    galleryStore.loadTimeline.mockClear();
    galleryStore.batchRestore.mockClear();
    galleryStore.restoreAllTrashed.mockClear();
    galleryStore.emptyTrash.mockClear();
    confirmDialog.open.mockClear();
    snackBar.open.mockClear();
  });

  async function configureModule() {
    await TestBed.configureTestingModule({
      imports: [TrashComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: ConfirmDialogService, useValue: confirmDialog },
        { provide: MatSnackBar, useValue: snackBar },
        {
          provide: MediaService,
          useValue: {
            getThumbnailUrl: () => of('blob:thumb'),
            getPosterUrl: () => of('blob:poster'),
            getFileUrl: () => of('blob:file'),
          },
        },
        { provide: AlbumStore, useValue: { items: () => [], loading: () => false, loaded: () => true, load: () => of([]), addMedia: () => of({ processed: 1, skipped: 0 }) } },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(undefined) }) } },
        {
          provide: UploadTrackerService,
          useValue: {
            registerRetagging: vi.fn(),
            visible: () => false,
            summary: () => ({
              totalTrackedItems: 0,
              requestCounts: { queued: 0, uploading: 0, completed: 0, failed: 0 },
              itemCounts: { pending: 0, processing: 0, failed: 0, upload_error: 0, duplicate: 0, done: 0, skipped: 0 },
              reviewItems: 0,
              reviewBatchCount: 0,
              latestReviewBatchId: null,
              activeBatchCount: 0,
              completedItems: 0,
              progressPercent: 0,
              hasActiveWork: false,
              latestBatch: null,
            }),
            countChips: () => [],
            dismiss: vi.fn(),
          },
        },
        { provide: MediaClientService, useValue: { getCharacterSuggestions: () => of([]) } },
        { provide: NavbarSearchService, useValue: searchService },
        { provide: TagsClientService, useValue: { list: () => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 6 }) } },
        { provide: ThemeService, useValue: { preference: () => 'system', cycle: () => {} } },
      ],
    }).compileComponents();
  }

  it('uses the shared layout and forces trashed state for search', async () => {
    await configureModule();

    const fixture = TestBed.createComponent(TrashComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('zukan-layout')).not.toBeNull();
    expect(element.querySelector('zukan-navbar')).not.toBeNull();
    expect(element.querySelector('zukan-media-browser')).not.toBeNull();
    expect(element.textContent).toContain('Restore all');
    expect(element.textContent).toContain('Empty trash');
    expect(galleryStore.setParams).toHaveBeenCalledWith({
      ocr_text: 'test text',
      state: MediaListState.TRASHED,
    });
  });

  it('confirms and triggers restore all from the page header', async () => {
    await configureModule();

    const fixture = TestBed.createComponent(TrashComponent);
    fixture.detectChanges();

    const button = Array.from(fixture.nativeElement.querySelectorAll('button'))
      .find((element) => (element as HTMLButtonElement).textContent?.includes('Restore all')) as HTMLButtonElement;
    button.click();

    expect(confirmDialog.open).toHaveBeenCalled();
    expect(galleryStore.restoreAllTrashed).toHaveBeenCalled();
  });

  it('confirms and triggers empty trash from the page header', async () => {
    await configureModule();

    const fixture = TestBed.createComponent(TrashComponent);
    fixture.detectChanges();

    const button = Array.from(fixture.nativeElement.querySelectorAll('button'))
      .find((element) => (element as HTMLButtonElement).textContent?.includes('Empty trash')) as HTMLButtonElement;
    button.click();

    expect(confirmDialog.open).toHaveBeenCalled();
    expect(galleryStore.emptyTrash).toHaveBeenCalled();
  });
});
