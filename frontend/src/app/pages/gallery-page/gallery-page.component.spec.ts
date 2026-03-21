import { AsyncPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { GalleryPageComponent } from './gallery-page.component';
import { GalleryNavbarComponent } from '../../components/gallery-search/gallery-navbar/gallery-navbar.component';
import { GalleryMediaCardComponent } from '../../components/gallery-media-card/gallery-media-card.component';
import { GalleryViewerComponent } from '../../components/gallery-viewer/gallery-viewer.component';
import { MediaRead } from '../../models/api';
import { MediaService } from '../../services/media.service';
import { GallerySearchState } from '../../components/gallery-search/gallery-search.models';
import { buildGalleryListQuery, createDefaultGallerySearchFilters } from '../../components/gallery-search/gallery-search.utils';
import { createMediaRead } from '../../testing/media-test.utils';

@Component({
  selector: 'app-gallery-navbar',
  template: '',
  standalone: true
})
class StubGalleryNavbarComponent {
  @Input({ required: true }) searchState!: GallerySearchState;
  @Output() readonly searchApplied = new EventEmitter<GallerySearchState>();
  @Output() readonly refreshRequested = new EventEmitter<void>();
}

@Component({
  selector: 'app-gallery-media-card',
  template: '',
  standalone: true
})
class StubGalleryMediaCardComponent {
  @Input({ required: true }) media!: MediaRead;
  @Output() readonly open = new EventEmitter<MediaRead>();
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

describe('GalleryPageComponent', () => {
  let fixture: ComponentFixture<GalleryPageComponent>;
  let component: GalleryPageComponent;
  let mediaService: {
    items$: BehaviorSubject<MediaRead[]>;
    loading$: BehaviorSubject<boolean>;
    loaded$: BehaviorSubject<boolean>;
    error$: BehaviorSubject<unknown | null>;
    loadPage: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mediaService = {
      items$: new BehaviorSubject<MediaRead[]>([]),
      loading$: new BehaviorSubject(false),
      loaded$: new BehaviorSubject(false),
      error$: new BehaviorSubject<unknown | null>(null),
      loadPage: vi.fn().mockReturnValue(of({ total: 0, page: 1, page_size: 60, items: [] }))
    };

    await TestBed.configureTestingModule({
      imports: [GalleryPageComponent],
      providers: [
        AsyncPipe,
        { provide: MediaService, useValue: mediaService }
      ]
    })
      .overrideComponent(GalleryPageComponent, {
        remove: { imports: [GalleryNavbarComponent, GalleryMediaCardComponent, GalleryViewerComponent] },
        add: { imports: [StubGalleryNavbarComponent, StubGalleryMediaCardComponent, StubGalleryViewerComponent] }
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
    component.reload();

    expect(mediaService.loadPage).toHaveBeenCalledTimes(2);
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
    mediaService.loading$.next(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading media...');

    mediaService.loading$.next(false);
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

  it('swallows load errors because the template renders the service error state', () => {
    mediaService.loadPage.mockReset();
    mediaService.loadPage.mockReturnValue(throwError(() => new Error('broken')));

    component.reload();

    expect(mediaService.loadPage).toHaveBeenCalled();
  });
});
