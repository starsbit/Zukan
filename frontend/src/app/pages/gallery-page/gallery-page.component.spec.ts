import { AsyncPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';

import { GalleryPageComponent } from './gallery-page.component';
import { GalleryNavbarComponent } from '../../components/gallery-search/gallery-navbar/gallery-navbar.component';
import { GalleryMediaCardComponent } from '../../components/gallery-media-card/gallery-media-card.component';
import { GalleryViewerComponent } from '../../components/gallery-viewer/gallery-viewer.component';
import { MediaRead } from '../../models/api';
import { MediaService } from '../../services/media.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { GallerySearchState } from '../../components/gallery-search/gallery-search.models';
import { buildGalleryListQuery, createDefaultGallerySearchFilters } from '../../components/gallery-search/gallery-search.utils';
import { createMediaRead } from '../../testing/media-test.utils';
import { GalleryUploadStatusIslandComponent } from '../../components/gallery-upload-status-island/gallery-upload-status-island.component';

@Component({
  selector: 'app-gallery-navbar',
  template: '',
  standalone: true
})
class StubGalleryNavbarComponent {
  @Input({ required: true }) searchState!: GallerySearchState;
  @Output() readonly searchApplied = new EventEmitter<GallerySearchState>();
  @Output() readonly refreshRequested = new EventEmitter<void>();
  @Output() readonly uploadRequested = new EventEmitter<void>();
}

@Component({
  selector: 'app-gallery-media-card',
  template: '',
  standalone: true
})
class StubGalleryMediaCardComponent {
  @Input({ required: true }) media!: MediaRead;
  @Input() selectionMode = false;
  @Input() selected = false;
  @Output() readonly open = new EventEmitter<MediaRead>();
  @Output() readonly selectionToggled = new EventEmitter<MediaRead>();
}

@Component({
  selector: 'app-gallery-viewer',
  template: '',
  standalone: true
})
class StubGalleryViewerComponent {
  @Input() media: MediaRead | null = null;
  @Output() readonly closed = new EventEmitter<void>();
}

@Component({
  selector: 'app-gallery-upload-status-island',
  template: '',
  standalone: true
})
class StubGalleryUploadStatusIslandComponent {}

describe('GalleryPageComponent', () => {
  let fixture: ComponentFixture<GalleryPageComponent>;
  let component: GalleryPageComponent;
  let mediaService: {
    items$: BehaviorSubject<MediaRead[]>;
    requestLoading$: BehaviorSubject<boolean>;
    loaded$: BehaviorSubject<boolean>;
    error$: BehaviorSubject<unknown | null>;
    mutationPending$: BehaviorSubject<boolean>;
    loadPage: ReturnType<typeof vi.fn>;
    batchUpdateMedia: ReturnType<typeof vi.fn>;
  };
  let mediaUploadService: {
    refreshRequested$: Subject<void>;
    startUpload: ReturnType<typeof vi.fn>;
  };
  let dialog: { open: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mediaService = {
      items$: new BehaviorSubject<MediaRead[]>([]),
      requestLoading$: new BehaviorSubject(false),
      loaded$: new BehaviorSubject(false),
      error$: new BehaviorSubject<unknown | null>(null),
      mutationPending$: new BehaviorSubject(false),
      loadPage: vi.fn().mockReturnValue(of({ total: 0, page: 1, page_size: 60, items: [] })),
      batchUpdateMedia: vi.fn().mockReturnValue(of({ processed: 1, skipped: 0 }))
    };
    mediaUploadService = {
      refreshRequested$: new Subject<void>(),
      startUpload: vi.fn()
    };
    dialog = {
      open: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [GalleryPageComponent],
      providers: [
        AsyncPipe,
        { provide: MediaService, useValue: mediaService },
        { provide: MediaUploadService, useValue: mediaUploadService },
        { provide: MatDialog, useValue: dialog }
      ]
    })
      .overrideComponent(GalleryPageComponent, {
        remove: { imports: [GalleryNavbarComponent, GalleryMediaCardComponent, GalleryViewerComponent, GalleryUploadStatusIslandComponent] },
        add: { imports: [StubGalleryNavbarComponent, StubGalleryMediaCardComponent, StubGalleryViewerComponent, StubGalleryUploadStatusIslandComponent] }
      })
      .compileComponents();

    fixture = TestBed.createComponent(GalleryPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads the default gallery query on creation', () => {
    expect(mediaService.loadPage).toHaveBeenCalledWith(buildGalleryListQuery('', createDefaultGallerySearchFilters()));
  });

  it('reloads the current query', () => {
    mediaService.loadPage.mockClear();
    component.reload();

    expect(mediaService.loadPage).toHaveBeenCalledTimes(1);
    expect(mediaService.loadPage).toHaveBeenLastCalledWith(buildGalleryListQuery('', createDefaultGallerySearchFilters()));
  });

  it('applies a new search state and reloads with the derived query', () => {
    const nextState: GallerySearchState = {
      searchText: 'tag:fox character:renamon',
      filters: {
        ...createDefaultGallerySearchFilters(),
        nsfw: 'include',
        media_type: ['video']
      }
    };

    component.applySearch(nextState);

    expect(component.searchState).toEqual(nextState);
    expect(component.selectedCount).toBe(0);
    expect(mediaService.loadPage).toHaveBeenLastCalledWith(buildGalleryListQuery(nextState.searchText, nextState.filters));
  });

  it('tracks the selected media while opening and closing the viewer', () => {
    const media = createMediaRead();

    component.openMedia(media);
    expect(component.selectedMedia).toEqual(media);

    component.closeMedia();
    expect(component.selectedMedia).toBeNull();
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

  it('opens the upload dialog from the navbar action', () => {
    component.openUploadDialog();

    expect(dialog.open).toHaveBeenCalled();
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
});
