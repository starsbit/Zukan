import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { MediaNavbarComponent } from './media-navbar.component';
import { MediaSearchState } from '../media-search.models';
import { createDefaultMediaSearchFilters } from '../media-search.utils';
import { MediaSearchBarComponent } from './media-search-bar.component';
import { MediaSearchOptionsDialogComponent } from './media-search-options-dialog.component';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-media-search-bar',
  template: '',
  standalone: true
})
class StubMediaSearchBarComponent {
  @Input() searchText = '';
  @Input() activeFilterCount = 0;
  @Output() readonly searchSubmitted = new EventEmitter<string>();
  @Output() readonly filtersRequested = new EventEmitter<void>();
  @Output() readonly cleared = new EventEmitter<void>();
}

describe('MediaNavbarComponent', () => {
  let fixture: ComponentFixture<MediaNavbarComponent>;
  let component: MediaNavbarComponent;
  let dialog: { open: ReturnType<typeof vi.fn> };
  let themeService: {
    isDarkMode: ReturnType<typeof vi.fn>;
    toggleMode: ReturnType<typeof vi.fn>;
  };
  const searchState: MediaSearchState = {
    searchText: 'fox',
    filters: {
      ...createDefaultMediaSearchFilters(),
      nsfw: 'include',
      media_type: ['image']
    }
  };

  beforeEach(async () => {
    dialog = {
      open: vi.fn()
    };
    themeService = {
      isDarkMode: vi.fn(() => false),
      toggleMode: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [MediaNavbarComponent],
      providers: [
        { provide: MatDialog, useValue: dialog },
        { provide: ThemeService, useValue: themeService }
      ]
    })
      .overrideProvider(MatDialog, { useValue: dialog })
      .overrideProvider(ThemeService, { useValue: themeService })
      .overrideComponent(MediaNavbarComponent, {
        remove: { imports: [MediaSearchBarComponent] },
        add: { imports: [StubMediaSearchBarComponent] }
      })
      .compileComponents();

    fixture = TestBed.createComponent(MediaNavbarComponent);
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
      filters: createDefaultMediaSearchFilters()
    });
  });

  it('opens the filters dialog and emits the chosen filters', () => {
    const nextFilters = {
      ...createDefaultMediaSearchFilters(),
      favorited: 'only' as const
    };
    const searchAppliedSpy = vi.fn();
    component.searchApplied.subscribe(searchAppliedSpy);
    dialog.open.mockReturnValue({
      afterClosed: () => of(nextFilters)
    });

    component.openFilters();

    expect(dialog.open).toHaveBeenCalledWith(MediaSearchOptionsDialogComponent, expect.objectContaining({
      data: {
        filters: searchState.filters,
        albumSelectionEnabled: true
      }
    }));
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

  it('opens the settings dialog from the toolbar button', () => {
    dialog.open.mockReturnValue({
      afterClosed: () => of(undefined)
    });

    (fixture.nativeElement.querySelector('button[aria-label="Open settings"]') as HTMLButtonElement).click();

    expect(dialog.open).toHaveBeenCalled();
  });

  it('toggles the theme from the toolbar button', () => {
    (fixture.nativeElement.querySelector('button[aria-label="Switch to dark mode"]') as HTMLButtonElement).click();

    expect(themeService.toggleMode).toHaveBeenCalledTimes(1);
  });

  it('emits settingsSaved when the settings dialog reports a successful save', () => {
    const settingsSavedSpy = vi.fn();
    component.settingsSaved.subscribe(settingsSavedSpy);
    dialog.open.mockReturnValue({
      afterClosed: () => of(true)
    });

    component.openSettings();

    expect(settingsSavedSpy).toHaveBeenCalledTimes(1);
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
    expect(fixture.nativeElement.querySelector('button[aria-label="Open settings"]')).toBeTruthy();
  });

  it('can hide the primary action button while keeping search controls', () => {
    fixture.componentRef.setInput('showPrimaryAction', false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button[aria-label="Upload media"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label="Empty trash"]')).toBeNull();
  });
});
