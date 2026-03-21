import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { GalleryNavbarComponent } from './gallery-navbar.component';
import { GallerySearchState } from '../gallery-search.models';
import { createDefaultGallerySearchFilters } from '../gallery-search.utils';
import { GallerySearchBarComponent } from '../gallery-search-bar/gallery-search-bar.component';

@Component({
  selector: 'app-gallery-search-bar',
  template: '',
  standalone: true
})
class StubGallerySearchBarComponent {
  @Input() searchText = '';
  @Input() activeFilterCount = 0;
  @Output() readonly searchSubmitted = new EventEmitter<string>();
  @Output() readonly filtersRequested = new EventEmitter<void>();
  @Output() readonly cleared = new EventEmitter<void>();
}

describe('GalleryNavbarComponent', () => {
  let fixture: ComponentFixture<GalleryNavbarComponent>;
  let component: GalleryNavbarComponent;
  let dialog: { open: ReturnType<typeof vi.fn> };
  const searchState: GallerySearchState = {
    searchText: 'fox',
    filters: {
      ...createDefaultGallerySearchFilters(),
      nsfw: 'include',
      media_type: ['image']
    }
  };

  beforeEach(async () => {
    dialog = {
      open: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [GalleryNavbarComponent],
      providers: [
        { provide: MatDialog, useValue: dialog }
      ]
    })
      .overrideProvider(MatDialog, { useValue: dialog })
      .overrideComponent(GalleryNavbarComponent, {
        remove: { imports: [GallerySearchBarComponent] },
        add: { imports: [StubGallerySearchBarComponent] }
      })
      .compileComponents();

    fixture = TestBed.createComponent(GalleryNavbarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('searchState', searchState);
    fixture.detectChanges();
  });

  it('computes the active filter count from the current search state', () => {
    expect(component.activeFilterCount).toBe(2);
  });

  it('emits an updated search state when search text changes', () => {
    const searchAppliedSpy = vi.fn();
    component.searchApplied.subscribe(searchAppliedSpy);

    component.applySearch('renamon');

    expect(searchAppliedSpy).toHaveBeenCalledWith({
      ...searchState,
      searchText: 'renamon'
    });
  });

  it('clears the search text and resets filters', () => {
    const searchAppliedSpy = vi.fn();
    component.searchApplied.subscribe(searchAppliedSpy);

    component.clearSearch();

    expect(searchAppliedSpy).toHaveBeenCalledWith({
      searchText: '',
      filters: createDefaultGallerySearchFilters()
    });
  });

  it('opens the filters dialog and emits the chosen filters', () => {
    const nextFilters = {
      ...createDefaultGallerySearchFilters(),
      favorited: 'only' as const
    };
    const searchAppliedSpy = vi.fn();
    component.searchApplied.subscribe(searchAppliedSpy);
    dialog.open.mockReturnValue({
      afterClosed: () => of(nextFilters)
    });

    component.openFilters();

    expect(dialog.open).toHaveBeenCalled();
    expect(searchAppliedSpy).toHaveBeenCalledWith({
      searchText: searchState.searchText,
      filters: nextFilters
    });
  });

  it('does not emit when the filters dialog closes without a result', () => {
    const searchAppliedSpy = vi.fn();
    component.searchApplied.subscribe(searchAppliedSpy);
    dialog.open.mockReturnValue({
      afterClosed: () => of(undefined)
    });

    component.openFilters();

    expect(searchAppliedSpy).not.toHaveBeenCalled();
  });

  it('emits refreshRequested from the toolbar button', () => {
    const refreshSpy = vi.fn();
    component.refreshRequested.subscribe(refreshSpy);

    (fixture.nativeElement.querySelector('button[aria-label="Refresh gallery"]') as HTMLButtonElement).click();

    expect(refreshSpy).toHaveBeenCalled();
  });

  it('opens the settings dialog from the toolbar button', () => {
    (fixture.nativeElement.querySelector('button[aria-label="Open settings"]') as HTMLButtonElement).click();

    expect(dialog.open).toHaveBeenCalled();
  });

  it('emits uploadRequested from the upload button', () => {
    const uploadSpy = vi.fn();
    component.uploadRequested.subscribe(uploadSpy);

    (fixture.nativeElement.querySelector('button[aria-label="Upload media"]') as HTMLButtonElement).click();

    expect(uploadSpy).toHaveBeenCalled();
  });

  it('switches to trash actions when trash mode is active', () => {
    const emptyTrashSpy = vi.fn();
    component.emptyTrashRequested.subscribe(emptyTrashSpy);

    fixture.componentRef.setInput('isTrashView', true);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button[aria-label="Empty trash"]') as HTMLButtonElement).click();

    expect(fixture.nativeElement.querySelector('button[aria-label="Upload media"]')).toBeNull();
    expect(emptyTrashSpy).toHaveBeenCalled();
    expect((fixture.nativeElement.querySelector('button[aria-label="Refresh trash"]') as HTMLButtonElement)).toBeTruthy();
  });
});
