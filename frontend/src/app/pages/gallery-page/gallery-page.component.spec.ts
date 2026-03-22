import '@angular/compiler';
import { AsyncPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, beforeEach, expect, it, vi } from 'vitest';

import { GalleryPageComponent } from './gallery-page.component';
import { GalleryNavbarComponent } from '../../components/gallery-search/gallery-navbar/gallery-navbar.component';
import { GalleryMediaCardComponent } from '../../components/gallery-media-card/gallery-media-card.component';
import { GalleryViewerComponent } from '../../components/gallery-viewer/gallery-viewer.component';
import { MediaRead } from '../../models/api';
import { MediaService } from '../../services/media.service';
import { MediaUploadService, type UploadReviewCandidate } from '../../services/media-upload.service';
import { GallerySearchState } from '../../components/gallery-search/gallery-search.models';
import { buildGalleryListQuery, createDefaultGallerySearchFilters } from '../../components/gallery-search/gallery-search.utils';
import { createMediaRead } from '../../testing/media-test.utils';
import { GalleryUploadStatusIslandComponent } from '../../components/gallery-upload-status-island/gallery-upload-status-island.component';
import { AlbumsService } from '../../services/albums.service';
import { AlbumRead } from '../../models/api';
import { SelectionToolbarComponent } from '../../components/selection-toolbar/selection-toolbar.component';

@Component({
  selector: 'app-gallery-navbar',
  template: '',
  standalone: true
})
class StubGalleryNavbarComponent {
  @Input({ required: true }) searchState!: GallerySearchState;
  @Input() isTrashView = false;
  @Output() readonly searchApplied = new EventEmitter<GallerySearchState>();
  @Output() readonly settingsSaved = new EventEmitter<void>();
  @Output() readonly uploadRequested = new EventEmitter<void>();
  @Output() readonly emptyTrashRequested = new EventEmitter<void>();
}

@Component({
  selector: 'app-gallery-media-card',
  template: '',
  standalone: true
})
class StubGalleryMediaCardComponent {
  @Input({ required: true }) media!: MediaRead;
  @Input() tileIndex = 0;
  @Input() selectionMode = false;
  @Input() selected = false;
  @Input() trashMode = false;
  @Output() readonly open = new EventEmitter<MediaRead>();
  @Output() readonly selectionToggled = new EventEmitter<MediaRead>();
  @Output() readonly restoreRequested = new EventEmitter<MediaRead>();
}

@Component({
  selector: 'app-gallery-viewer',
  template: '',
  standalone: true
})
class StubGalleryViewerComponent {
  @Input() media: MediaRead | null = null;
  @Input() canRestore = false;
  @Input() canDelete = false;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly deleteRequested = new EventEmitter<MediaRead>();
  @Output() readonly restoreRequested = new EventEmitter<MediaRead>();
  @Output() readonly updated = new EventEmitter<MediaRead>();
}

@Component({
  selector: 'app-gallery-upload-status-island',
  template: '',
  standalone: true
})
class StubGalleryUploadStatusIslandComponent {}

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

describe('GalleryPageComponent', () => {
  const album: AlbumRead = {
    id: 'album-1',
    owner_id: 'user-1',
    name: 'Road Trip',
    description: null,
    cover_media_id: null,
    media_count: 2,
    created_at: '2026-03-21T00:00:00Z',
    updated_at: '2026-03-21T00:00:00Z'
  };

  let fixture: ComponentFixture<GalleryPageComponent>;
  let component: GalleryPageComponent;
  let mediaService: {
    items$: BehaviorSubject<MediaRead[]>;
    requestLoading$: BehaviorSubject<boolean>;
    loaded$: BehaviorSubject<boolean>;
    error$: BehaviorSubject<unknown | null>;
    mutationPending$: BehaviorSubject<boolean>;
    loadPage: ReturnType<typeof vi.fn>;
    loadNextPage: ReturnType<typeof vi.fn>;
    batchUpdateMedia: ReturnType<typeof vi.fn>;
    restoreMediaBatch: ReturnType<typeof vi.fn>;
    restoreMedia: ReturnType<typeof vi.fn>;
    updateMedia: ReturnType<typeof vi.fn>;
    deleteMedia: ReturnType<typeof vi.fn>;
    emptyTrash: ReturnType<typeof vi.fn>;
  };
  let mediaUploadService: {
    refreshRequested$: Subject<void>;
    reviewRequested$: Subject<UploadReviewCandidate[]>;
    startUpload: ReturnType<typeof vi.fn>;
  };
  let albumsService: {
    albums$: BehaviorSubject<AlbumRead[]>;
    snapshot: { albums: AlbumRead[] };
    loadAlbums: ReturnType<typeof vi.fn>;
    addMedia: ReturnType<typeof vi.fn>;
  };
  let dialog: { open: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let routeData: BehaviorSubject<Record<string, unknown>>;

  beforeEach(async () => {
    mediaService = {
      items$: new BehaviorSubject<MediaRead[]>([]),
      requestLoading$: new BehaviorSubject(false),
      loaded$: new BehaviorSubject(false),
      error$: new BehaviorSubject<unknown | null>(null),
      mutationPending$: new BehaviorSubject(false),
      loadPage: vi.fn().mockReturnValue(of({ total: 0, page: 1, page_size: 60, items: [] })),
      loadNextPage: vi.fn().mockReturnValue(of(null)),
      batchUpdateMedia: vi.fn().mockReturnValue(of({ processed: 1, skipped: 0 })),
      restoreMediaBatch: vi.fn().mockReturnValue(of({ processed: 1, skipped: 0 })),
      restoreMedia: vi.fn().mockReturnValue(of(createMediaRead())),
      updateMedia: vi.fn().mockReturnValue(of(createMediaRead())),
      deleteMedia: vi.fn().mockReturnValue(of(undefined)),
      emptyTrash: vi.fn().mockReturnValue(of(null))
    };
    mediaUploadService = {
      refreshRequested$: new Subject<void>(),
      reviewRequested$: new Subject<UploadReviewCandidate[]>(),
      startUpload: vi.fn()
    };
    albumsService = {
      albums$: new BehaviorSubject<AlbumRead[]>([album]),
      snapshot: { albums: [album] },
      loadAlbums: vi.fn().mockReturnValue(of([album])),
      addMedia: vi.fn().mockReturnValue(of({ processed: 2, skipped: 0 }))
    };
    dialog = {
      open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined) })
    };
    snackBar = {
      open: vi.fn()
    };
    routeData = new BehaviorSubject<Record<string, unknown>>({ state: 'active' });

    await TestBed.configureTestingModule({
      imports: [GalleryPageComponent],
      providers: [
        AsyncPipe,
        provideRouter([]),
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: MediaService, useValue: mediaService },
        { provide: AlbumsService, useValue: albumsService },
        { provide: MediaUploadService, useValue: mediaUploadService },
        { provide: ActivatedRoute, useValue: { data: routeData.asObservable() } }
      ]
    })
      .overrideComponent(GalleryPageComponent, {
        remove: { imports: [GalleryNavbarComponent, GalleryMediaCardComponent, GalleryViewerComponent, GalleryUploadStatusIslandComponent, SelectionToolbarComponent] },
        add: { imports: [StubGalleryNavbarComponent, StubGalleryMediaCardComponent, StubGalleryViewerComponent, StubGalleryUploadStatusIslandComponent, StubSelectionToolbarComponent] }
      })
      .compileComponents();

    fixture = TestBed.createComponent(GalleryPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads the default gallery query on creation', () => {
    expect(mediaService.loadPage).toHaveBeenCalledWith(buildGalleryListQuery('', createDefaultGallerySearchFilters()));
  });

  it('enables the custom scrollbar mode while the gallery page is mounted', () => {
    expect(document.documentElement.classList.contains('gallery-custom-scrollbar')).toBe(true);
    expect(document.body.classList.contains('gallery-custom-scrollbar')).toBe(true);
  });

  it('loads the trash query when the route switches to trash mode', () => {
    mediaService.loadPage.mockClear();

    routeData.next({ state: 'trashed' });

    expect(component.isTrashView).toBe(true);
    expect(mediaService.loadPage).toHaveBeenCalledWith({
      ...buildGalleryListQuery('', createDefaultGallerySearchFilters()),
      state: 'trashed'
    });
  });

  it('reloads the current query', () => {
    mediaService.loadPage.mockClear();
    component.reload();

    expect(mediaService.loadPage).toHaveBeenCalledTimes(1);
    expect(mediaService.loadPage).toHaveBeenLastCalledWith(buildGalleryListQuery('', createDefaultGallerySearchFilters()));
  });

  it('reloads when settings are saved from the navbar', () => {
    mediaService.loadPage.mockClear();

    const navbar = fixture.debugElement.query(By.directive(StubGalleryNavbarComponent));
    (navbar.componentInstance as StubGalleryNavbarComponent).settingsSaved.emit();

    expect(mediaService.loadPage).toHaveBeenCalledTimes(1);
    expect(mediaService.loadPage).toHaveBeenLastCalledWith(buildGalleryListQuery('', createDefaultGallerySearchFilters()));
  });

  it('applies a new search state and reloads with the derived query', () => {
    const nextState: GallerySearchState = {
      searchText: 'tag:fox character:renamon',
      filters: {
        ...createDefaultGallerySearchFilters(),
        album_id: 'album-1',
        nsfw: 'include',
        media_type: ['video']
      }
    };

    component.applySearch(nextState);

    expect(component.searchState).toEqual(nextState);
    expect(component.selectedCount).toBe(0);
    expect(mediaService.loadPage).toHaveBeenLastCalledWith(buildGalleryListQuery(nextState.searchText, nextState.filters));
  });

  it('adds selected media to an album from the selection toolbar flow', () => {
    component.selectedMediaIds = new Set(['media-1', 'media-2']);
    dialog.open.mockReturnValue({ afterClosed: () => of('album-1') });

    component.addSelectedToAlbum();

    expect(albumsService.addMedia).toHaveBeenCalledWith('album-1', { media_ids: ['media-1', 'media-2'] });
    expect(component.selectedCount).toBe(0);
    expect(snackBar.open).toHaveBeenCalled();
  });

  it('tracks the selected media while opening and closing the viewer', () => {
    const media = createMediaRead();

    component.openMedia(media);
    expect(component.selectedMedia).toEqual(media);

    component.closeMedia();
    expect(component.selectedMedia).toBeNull();
  });

  it('updates the selected media when the viewer saves metadata', () => {
    const media = createMediaRead();
    const updated = createMediaRead({ id: media.id, tags: ['fox', 'hero'] });

    component.openMedia(media);
    component.updateSelectedMedia(updated);

    expect(component.selectedMedia).toEqual(updated);
  });

  it('renders loading, error, and empty states from the service streams', () => {
    mediaService.requestLoading$.next(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading media...');

    mediaService.requestLoading$.next(false);
    mediaService.error$.next(new Error('broken'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Gallery unavailable');

    mediaService.error$.next(null);
    mediaService.items$.next([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No matching media');
  });

  it('renders the media grid when items are available', () => {
    mediaService.items$.next([createMediaRead(), createMediaRead({ id: 'media-2' })]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('app-gallery-media-card')).toHaveLength(2);
  });

  it('opens upload review dialogs and saves the returned metadata updates', () => {
    const candidate = {
      media: createMediaRead({ id: 'media-7', character_name: null }),
      issue: 'missing_character'
    } satisfies UploadReviewCandidate;
    const updated = createMediaRead({ id: 'media-7', character_name: 'ikari_shinji', tags: ['fox', 'hero'] });
    dialog.open.mockReturnValue({
      afterClosed: () => of({ action: 'save', characterName: 'ikari_shinji', tags: ['fox', 'hero'] })
    });
    mediaService.updateMedia.mockReturnValue(of(updated));

    mediaUploadService.reviewRequested$.next([candidate]);

    expect(dialog.open).toHaveBeenCalled();
    expect(mediaService.updateMedia).toHaveBeenCalledWith('media-7', {
      character_name: 'ikari_shinji',
      tags: ['fox', 'hero']
    });
  });

  it('renders media grouped under date headings', () => {
    mediaService.items$.next([
      createMediaRead({ metadata: { ...createMediaRead().metadata, captured_at: '2024-01-20T12:00:00.000Z' } }),
      createMediaRead({ id: 'media-2', metadata: { ...createMediaRead().metadata, captured_at: '2024-01-20T06:00:00.000Z' } }),
      createMediaRead({ id: 'media-3', metadata: { ...createMediaRead().metadata, captured_at: '2024-01-19T18:00:00.000Z' } })
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.gallery-group')).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Jan 20');
    expect(fixture.nativeElement.textContent).toContain('Jan 19');
  });

  it('tracks multi-selection and exits selection mode when cleared', () => {
    const media = createMediaRead();
    const second = createMediaRead({ id: 'media-2' });

    component.toggleSelection(media);
    expect(component.selectionMode).toBe(true);
    expect(component.selectedCount).toBe(1);
    expect(component.isSelected(media.id)).toBe(true);

    component.toggleSelection(second);
    expect(component.selectedCount).toBe(2);

    component.toggleSelection(media);
    expect(component.selectedCount).toBe(1);
    expect(component.isSelected(media.id)).toBe(false);

    component.clearSelection();
    expect(component.selectionMode).toBe(false);
    expect(component.selectedCount).toBe(0);
  });

  it('routes open requests into selection toggles while selection mode is active', () => {
    const media = createMediaRead();
    const second = createMediaRead({ id: 'media-2' });

    component.toggleSelection(media);
    component.openMedia(second);

    expect(component.selectedMedia).toBeNull();
    expect(component.isSelected(second.id)).toBe(true);
    expect(component.selectedCount).toBe(2);
  });

  it('selects all currently visible items when ctrl+a is pressed in selection mode', () => {
    const media = createMediaRead();
    const second = createMediaRead({ id: 'media-2' });
    const third = createMediaRead({ id: 'media-3' });
    mediaService.items$.next([media, second, third]);
    component.toggleSelection(media);

    const preventDefault = vi.fn();
    component.onDocumentKeydown({
      ctrlKey: true,
      metaKey: false,
      key: 'a',
      preventDefault,
      target: document.body
    } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(component.selectedCount).toBe(3);
    expect(component.isSelected(media.id)).toBe(true);
    expect(component.isSelected(second.id)).toBe(true);
    expect(component.isSelected(third.id)).toBe(true);
  });

  it('does not override native ctrl+a inside editable fields', () => {
    const media = createMediaRead();
    const second = createMediaRead({ id: 'media-2' });
    mediaService.items$.next([media, second]);
    component.toggleSelection(media);

    const input = document.createElement('input');
    const preventDefault = vi.fn();
    component.onDocumentKeydown({
      ctrlKey: true,
      metaKey: false,
      key: 'a',
      preventDefault,
      target: input
    } as unknown as KeyboardEvent);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(component.selectedCount).toBe(1);
    expect(component.isSelected(second.id)).toBe(false);
  });

  it('clears the current selection when escape is pressed', () => {
    const media = createMediaRead();
    const second = createMediaRead({ id: 'media-2' });
    component.toggleSelection(media);
    component.toggleSelection(second);

    const preventDefault = vi.fn();
    component.onDocumentKeydown({
      key: 'Escape',
      preventDefault,
      target: document.body
    } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(component.selectionMode).toBe(false);
    expect(component.selectedCount).toBe(0);
  });

  it('clears the current search text when escape is pressed in browse mode', () => {
    const filters = {
      ...createDefaultGallerySearchFilters(),
      nsfw: 'include' as const
    };
    component.applySearch({
      searchText: 'tag:fox',
      filters
    });
    mediaService.loadPage.mockClear();

    const preventDefault = vi.fn();
    component.onDocumentKeydown({
      key: 'Escape',
      preventDefault,
      target: document.body
    } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(component.searchState).toEqual({
      searchText: '',
      filters
    });
    expect(mediaService.loadPage).toHaveBeenCalledWith(buildGalleryListQuery('', filters));
  });

  it('does not clear the current search text from an editable target', () => {
    component.applySearch({
      searchText: 'tag:fox',
      filters: createDefaultGallerySearchFilters()
    });
    mediaService.loadPage.mockClear();

    const input = document.createElement('input');
    const preventDefault = vi.fn();
    component.onDocumentKeydown({
      key: 'Escape',
      preventDefault,
      target: input
    } as unknown as KeyboardEvent);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(component.searchState.searchText).toBe('tag:fox');
    expect(mediaService.loadPage).not.toHaveBeenCalled();
  });

  it('selects all items in a date group from the group action', () => {
    const dayOneA = createMediaRead({ metadata: { ...createMediaRead().metadata, captured_at: '2024-01-20T12:00:00.000Z' } });
    const dayOneB = createMediaRead({ id: 'media-2', metadata: { ...createMediaRead().metadata, captured_at: '2024-01-20T06:00:00.000Z' } });
    const dayTwo = createMediaRead({ id: 'media-3', metadata: { ...createMediaRead().metadata, captured_at: '2024-01-19T18:00:00.000Z' } });
    mediaService.items$.next([dayOneA, dayOneB, dayTwo]);

    component.selectGroup(component.groupedItems[0]);

    expect(component.selectedCount).toBe(2);
    expect(component.isSelected(dayOneA.id)).toBe(true);
    expect(component.isSelected(dayOneB.id)).toBe(true);
    expect(component.isSelected(dayTwo.id)).toBe(false);
  });

  it('deletes the selected items and clears selection on success', () => {
    const media = createMediaRead();
    const second = createMediaRead({ id: 'media-2' });
    component.toggleSelection(media);
    component.toggleSelection(second);

    component.deleteSelected();

    expect(mediaService.batchUpdateMedia).toHaveBeenCalledWith({
      media_ids: [media.id, second.id],
      deleted: true
    });
    expect(component.selectedCount).toBe(0);
  });

  it('restores selected items from trash and clears selection on success', () => {
    routeData.next({ state: 'trashed' });
    const media = createMediaRead({ deleted_at: '2026-03-21T00:00:00Z' });
    const second = createMediaRead({ id: 'media-2', deleted_at: '2026-03-21T00:00:00Z' });
    component.toggleSelection(media);
    component.toggleSelection(second);

    component.restoreSelected();

    expect(mediaService.restoreMediaBatch).toHaveBeenCalledWith([media.id, second.id]);
    expect(component.selectedCount).toBe(0);
  });

  it('restores a single trashed item and closes the viewer for that item', () => {
    routeData.next({ state: 'trashed' });
    const media = createMediaRead({ deleted_at: '2026-03-21T00:00:00Z' });
    component.selectedMedia = media;
    component.toggleSelection(media);

    component.restoreMedia(media);

    expect(mediaService.restoreMedia).toHaveBeenCalledWith(media.id);
    expect(component.selectedMedia).toBeNull();
    expect(component.selectedCount).toBe(0);
  });

  it('deletes a single active item and closes the viewer for that item', () => {
    const media = createMediaRead();
    component.selectedMedia = media;
    component.toggleSelection(media);

    component.deleteMedia(media);

    expect(mediaService.deleteMedia).toHaveBeenCalledWith(media.id);
    expect(component.selectedMedia).toBeNull();
    expect(component.selectedCount).toBe(0);
  });

  it('empties the trash and clears selection state', () => {
    routeData.next({ state: 'trashed' });
    const media = createMediaRead({ deleted_at: '2026-03-21T00:00:00Z' });
    component.selectedMedia = media;
    component.toggleSelection(media);

    component.emptyTrash();

    expect(mediaService.emptyTrash).toHaveBeenCalled();
    expect(component.selectedMedia).toBeNull();
    expect(component.selectedCount).toBe(0);
  });

  it('keeps the current selection when delete fails', () => {
    mediaService.batchUpdateMedia.mockReturnValueOnce(throwError(() => new Error('broken')));
    const media = createMediaRead();
    component.toggleSelection(media);

    component.deleteSelected();

    expect(component.selectedCount).toBe(1);
    expect(component.selectionMode).toBe(true);
  });

  it('swallows load errors because the template renders the service error state', () => {
    mediaService.loadPage.mockReset();
    mediaService.loadPage.mockReturnValue(throwError(() => new Error('broken')));

    component.reload();

    expect(mediaService.loadPage).toHaveBeenCalled();
  });

  it('starts upload from the file picker selection', () => {
    const file = new File(['a'], 'picked.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    input.value = 'picked.png';

    component.onUploadSelection({ target: input } as unknown as Event);

    expect(mediaUploadService.startUpload).toHaveBeenCalledWith([file]);
    expect(input.value).toBe('');
  });

  it('starts upload when files are dropped onto the gallery', () => {
    const file = new File(['a'], 'drop.png', { type: 'image/png' });
    const dragEvent = {
      preventDefault: vi.fn(),
      dataTransfer: {
        files: [file],
        types: ['Files']
      }
    } as unknown as DragEvent;

    component.onDrop(dragEvent);

    expect(mediaUploadService.startUpload).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'drop.png' })
    ]);
    expect(component.dragActive).toBe(false);
  });

  it('tracks drag state and reloads when upload processing asks for a refresh', () => {
    const dragEnter = {
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ['Files']
      }
    } as unknown as DragEvent;
    const dragLeave = {
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ['Files']
      }
    } as unknown as DragEvent;

    mediaService.loadPage.mockClear();

    component.onDragEnter(dragEnter);
    expect(component.dragActive).toBe(true);

    component.onDragLeave(dragLeave);
    expect(component.dragActive).toBe(false);

    mediaUploadService.refreshRequested$.next();
    expect(mediaService.loadPage).toHaveBeenCalledTimes(1);
  });

  it('loads next media page when the gallery scroll nears the bottom', () => {
    (component as unknown as { galleryScroller: { nativeElement: HTMLElement } }).galleryScroller = {
      nativeElement: {
        scrollHeight: 2400,
        scrollTop: 1700,
        clientHeight: 200
      } as HTMLElement
    };

    component.onGalleryScroll();

    expect(mediaService.loadNextPage).toHaveBeenCalledTimes(1);
  });

  it('renders trash-specific copy when the trash route is active', () => {
    routeData.next({ state: 'trashed' });
    mediaService.items$.next([]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Trash is empty');
    expect(fixture.nativeElement.textContent).toContain('Trash');
    expect(fixture.nativeElement.textContent).toContain('Items in trash are deleted automatically after 30 days.');
  });

  it('removes the custom scrollbar mode when the gallery page is destroyed', () => {
    fixture.destroy();

    expect(document.documentElement.classList.contains('gallery-custom-scrollbar')).toBe(false);
    expect(document.body.classList.contains('gallery-custom-scrollbar')).toBe(false);
  });
});
