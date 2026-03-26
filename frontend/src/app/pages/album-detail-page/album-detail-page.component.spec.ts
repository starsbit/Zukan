import '@angular/compiler';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { BehaviorSubject, of } from 'rxjs';
import { describe, beforeEach, expect, it, vi } from 'vitest';

import { AlbumDetailPageComponent } from './album-detail-page.component';
import { AlbumRead, MediaCursorPage } from '../../models/api';
import { AppSidebarComponent } from '../../components/app-sidebar/app-sidebar.component';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { MediaGroupedListComponent } from '../../components/media-grouped-list/media-grouped-list.component';
import { MediaNavbarComponent } from '../../components/media-search/media-navbar.component';
import { MediaSearchState } from '../../components/media-search/media-search.models';
import { buildMediaListQuery, createDefaultMediaSearchFilters } from '../../components/media-search/media-search.utils';
import { MediaViewerComponent } from '../../components/media-viewer/media-viewer.component';
import { SelectionToolbarComponent } from '../../components/selection-toolbar/selection-toolbar.component';
import { AlbumsService } from '../../services/albums.service';
import { MediaService } from '../../services/media.service';
import { createMediaRead } from '../../testing/media-test.utils';

@Component({
  selector: 'app-sidebar',
  template: '',
  standalone: true
})
class StubSidebarComponent {}

@Component({
  selector: 'app-media-navbar',
  template: '',
  standalone: true
})
class StubMediaNavbarComponent {
  @Input({ required: true }) searchState!: MediaSearchState;
  @Input() albumSelectionEnabled = true;
  @Input() showPrimaryAction = true;
  @Output() readonly searchApplied = new EventEmitter<MediaSearchState>();
  @Output() readonly settingsSaved = new EventEmitter<void>();
}

@Component({
  selector: 'app-media-grouped-list',
  template: '',
  standalone: true
})
class StubMediaGroupedListComponent {
  @Input({ required: true }) groups!: { key: string; label: string; items: unknown[] }[];
  @Input({ required: true }) selectedIds!: Set<string>;
  @Input() selectionMode = false;
  @Input() trashMode = false;
  @Input() regroupAnimating = false;
  @Input() ariaLabel = 'Media list';
  @Output() readonly groupSelected = new EventEmitter<{ key: string; label: string; items: unknown[] }>();
  @Output() readonly mediaOpened = new EventEmitter<unknown>();
  @Output() readonly mediaSelectionToggled = new EventEmitter<unknown>();
  @Output() readonly mediaRestoreRequested = new EventEmitter<unknown>();
}

@Component({
  selector: 'app-media-viewer',
  template: '',
  standalone: true
})
class StubMediaViewerComponent {
  @Input() media: unknown;
  @Input() canRestore = false;
  @Input() canDelete = false;
  @Output() readonly closed = new EventEmitter<void>();
}

@Component({
  selector: 'app-selection-toolbar',
  template: '<ng-content select="[selectionToolbarActions]"></ng-content>',
  standalone: true
})
class StubSelectionToolbarComponent {
  @Input() selectedCount = 0;
  @Input() clearButtonAriaLabel = 'Clear selection';
  @Input() ariaLabel = 'Selection toolbar';
  @Output() readonly clearRequested = new EventEmitter<void>();
}

describe('AlbumDetailPageComponent', () => {
  let fixture: ComponentFixture<AlbumDetailPageComponent>;
  let component: AlbumDetailPageComponent;
  let albumsService: {
    selectedAlbum$: BehaviorSubject<AlbumRead | null>;
    selectedAlbumMedia$: BehaviorSubject<MediaCursorPage | null>;
    loading$: BehaviorSubject<boolean>;
    error$: BehaviorSubject<unknown | null>;
    loadAlbum: ReturnType<typeof vi.fn>;
    loadAlbumMedia: ReturnType<typeof vi.fn>;
    updateAlbum: ReturnType<typeof vi.fn>;
    deleteAlbum: ReturnType<typeof vi.fn>;
    removeMedia: ReturnType<typeof vi.fn>;
  };
  let mediaService: {
    items$: BehaviorSubject<ReturnType<typeof createMediaRead>[]>;
    loading$: BehaviorSubject<boolean>;
    error$: BehaviorSubject<unknown | null>;
    loadPage: ReturnType<typeof vi.fn>;
    loadSearchPage: ReturnType<typeof vi.fn>;
    loadNextPage: ReturnType<typeof vi.fn>;
  };
  let dialog: { open: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };

  const album: AlbumRead = {
    id: 'album-1',
    owner_id: 'user-1',
    name: 'Road Trip',
    description: 'Spring photos',
    cover_media_id: null,
    media_count: 1,
    version: 1,
    created_at: '2026-03-21T00:00:00Z',
    updated_at: '2026-03-21T00:00:00Z'
  };
  const albumMedia: MediaCursorPage = {
    total: 1,
    next_cursor: null,
    has_more: false,
    page_size: 20,
    items: [createMediaRead()]
  };

  beforeEach(async () => {
    albumsService = {
      selectedAlbum$: new BehaviorSubject<AlbumRead | null>(album),
      selectedAlbumMedia$: new BehaviorSubject<MediaCursorPage | null>(albumMedia),
      loading$: new BehaviorSubject(false),
      error$: new BehaviorSubject<unknown | null>(null),
      loadAlbum: vi.fn().mockReturnValue(of(album)),
      loadAlbumMedia: vi.fn().mockReturnValue(of(albumMedia)),
      updateAlbum: vi.fn().mockReturnValue(of({ ...album, name: 'Renamed' })),
      deleteAlbum: vi.fn().mockReturnValue(of(null)),
      removeMedia: vi.fn().mockReturnValue(of({ processed: 1, skipped: 0 }))
    };
    mediaService = {
      items$: new BehaviorSubject([createMediaRead()]),
      loading$: new BehaviorSubject(false),
      error$: new BehaviorSubject<unknown | null>(null),
      loadPage: vi.fn().mockReturnValue(of(albumMedia)),
      loadSearchPage: vi.fn().mockReturnValue(of(albumMedia)),
      loadNextPage: vi.fn().mockReturnValue(of(null))
    };
    dialog = {
      open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined) })
    };
    snackBar = {
      open: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [AlbumDetailPageComponent],
      providers: [
        provideRouter([{ path: 'albums', component: StubSidebarComponent }]),
        { provide: AlbumsService, useValue: albumsService },
        { provide: MediaService, useValue: mediaService },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of({
              get: (key: string) => key === 'albumId' ? 'album-1' : null
            })
          }
        }
      ]
    })
      .overrideComponent(AlbumDetailPageComponent, {
        remove: { imports: [AppSidebarComponent, MediaGroupedListComponent, MediaNavbarComponent, MediaViewerComponent, SelectionToolbarComponent] },
        add: { imports: [StubSidebarComponent, StubMediaGroupedListComponent, StubMediaNavbarComponent, StubMediaViewerComponent, StubSelectionToolbarComponent] }
      })
      .compileComponents();

    fixture = TestBed.createComponent(AlbumDetailPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads album detail and media on creation', () => {
    expect(albumsService.loadAlbum).toHaveBeenCalledWith('album-1');
    expect(mediaService.loadSearchPage).toHaveBeenCalledWith({
      ...buildMediaListQuery('', createDefaultMediaSearchFilters()),
      album_id: 'album-1',
      page_size: 120
    });
  });

  it('renames the album from the dialog flow', () => {
    dialog.open.mockReturnValue({ afterClosed: () => of({ name: 'Renamed', description: 'Updated notes' }) });

    component.renameAlbum('Road Trip', 'Spring photos');

    expect(albumsService.updateAlbum).toHaveBeenCalledWith('album-1', { name: 'Renamed', description: 'Updated notes' });
    expect(snackBar.open).toHaveBeenCalled();
  });

  it('opens a material confirmation dialog before deleting the album', () => {
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });

    component.deleteAlbum('Road Trip');

    expect(dialog.open).toHaveBeenCalledWith(ConfirmDialogComponent, expect.objectContaining({
      data: expect.objectContaining({
        title: 'Delete album',
        confirmLabel: 'Delete',
        confirmButtonColor: 'warn'
      })
    }));
    expect(albumsService.deleteAlbum).toHaveBeenCalledWith('album-1');
  });

  it('does not delete the album when the confirmation dialog is cancelled', () => {
    dialog.open.mockReturnValue({ afterClosed: () => of(false) });

    component.deleteAlbum('Road Trip');

    expect(albumsService.deleteAlbum).not.toHaveBeenCalled();
  });

  it('applies search through the shared gallery navbar within the current album only', () => {
    const nextState: MediaSearchState = {
      searchText: 'tag:sky',
      filters: {
        ...createDefaultMediaSearchFilters(),
        nsfw: 'include'
      }
    };

    component.applySearch(nextState);

    expect(mediaService.loadSearchPage).toHaveBeenLastCalledWith({
      ...buildMediaListQuery('tag:sky', nextState.filters),
      album_id: 'album-1',
      page_size: 120
    });
  });

  it('toggles selection state when a media card emits selectionToggled', () => {
    const media = albumMedia.items[0];

    component.toggleSelection(media);

    expect(component.selectionMode).toBe(true);
    expect(component.selectedCount).toBe(1);
    expect(component.isSelected(media.id)).toBe(true);

    component.toggleSelection(media);

    expect(component.selectionMode).toBe(false);
    expect(component.selectedCount).toBe(0);
    expect(component.isSelected(media.id)).toBe(false);
  });

  it('turns open actions into selection toggles while selection mode is active', () => {
    const [first, second] = [createMediaRead({ id: 'media-1' }), createMediaRead({ id: 'media-2' })];
    mediaService.items$.next([first, second]);

    component.toggleSelection(first);
    component.openMedia(second);

    expect(component.isSelected(first.id)).toBe(true);
    expect(component.isSelected(second.id)).toBe(true);
    expect(component.selectedMedia).toBeNull();
  });

  it('removes the selected media from the current album and clears selection', () => {
    const [first, second] = [createMediaRead({ id: 'media-1' }), createMediaRead({ id: 'media-2' })];
    albumsService.loadAlbum.mockClear();
    mediaService.loadSearchPage.mockClear();

    component.toggleSelection(first);
    component.toggleSelection(second);
    component.removeSelectedFromAlbum();

    expect(albumsService.removeMedia).toHaveBeenCalledWith('album-1', { media_ids: ['media-1', 'media-2'] });
    expect(component.selectionMode).toBe(false);
    expect(component.selectedCount).toBe(0);
    expect(albumsService.loadAlbum).toHaveBeenCalledWith('album-1');
    expect(mediaService.loadSearchPage).toHaveBeenCalledWith({
      ...buildMediaListQuery('', createDefaultMediaSearchFilters()),
      album_id: 'album-1',
      page_size: 120
    });
    expect(snackBar.open).toHaveBeenCalledWith('Removed selected images from the album.', 'Close', { duration: 2500 });
  });

  it('clears the current selection on escape instead of navigating away', () => {
    const navigateSpy = vi.spyOn((component as unknown as { router: Router }).router, 'navigate')
      .mockResolvedValue(true);
    component.toggleSelection(createMediaRead({ id: 'media-1' }));

    component.onDocumentKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(component.selectionMode).toBe(false);
    expect(component.selectedCount).toBe(0);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('navigates back to albums when escape is pressed outside editable fields and nothing is selected', () => {
    const navigateSpy = vi.spyOn((component as unknown as { router: Router }).router, 'navigate')
      .mockResolvedValue(true);

    component.onDocumentKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(navigateSpy).toHaveBeenCalledWith(['/albums']);
  });

  it('does not navigate back on escape while the media viewer is open', () => {
    const navigateSpy = vi.spyOn((component as unknown as { router: Router }).router, 'navigate')
      .mockResolvedValue(true);
    component.selectedMedia = createMediaRead();

    component.onDocumentKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('loads next page when scrolling near the end of the document', () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2200
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 900
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 700
    });

    component.onWindowScroll();

    expect(mediaService.loadNextPage).toHaveBeenCalledTimes(1);
  });

  it('groups media by captured day for gallery-style rendering', () => {
    const dayOneA = createMediaRead({ id: 'media-1', metadata: { ...createMediaRead().metadata, captured_at: '2026-03-21T08:00:00Z' } });
    const dayOneB = createMediaRead({ id: 'media-2', metadata: { ...createMediaRead().metadata, captured_at: '2026-03-21T12:00:00Z' } });
    const dayTwo = createMediaRead({ id: 'media-3', metadata: { ...createMediaRead().metadata, captured_at: '2026-03-20T09:30:00Z' } });

    mediaService.items$.next([dayOneA, dayOneB, dayTwo]);

    expect(component.groupedItems).toHaveLength(2);
    expect(component.groupedItems[0]?.items.map((item) => item.id)).toEqual(['media-1', 'media-2']);
    expect(component.groupedItems[1]?.items.map((item) => item.id)).toEqual(['media-3']);
  });

  it('selects all items in a group from the group action', () => {
    const dayOneA = createMediaRead({ id: 'media-1', metadata: { ...createMediaRead().metadata, captured_at: '2026-03-21T08:00:00Z' } });
    const dayOneB = createMediaRead({ id: 'media-2', metadata: { ...createMediaRead().metadata, captured_at: '2026-03-21T12:00:00Z' } });
    const dayTwo = createMediaRead({ id: 'media-3', metadata: { ...createMediaRead().metadata, captured_at: '2026-03-20T09:30:00Z' } });

    mediaService.items$.next([dayOneA, dayOneB, dayTwo]);
    const firstGroup = component.groupedItems[0];
    expect(firstGroup).toBeTruthy();

    component.selectGroup(firstGroup!);

    expect(component.isSelected(dayOneA.id)).toBe(true);
    expect(component.isSelected(dayOneB.id)).toBe(true);
    expect(component.isSelected(dayTwo.id)).toBe(false);
    expect(component.isGroupSelected(firstGroup!)).toBe(true);
  });
});
