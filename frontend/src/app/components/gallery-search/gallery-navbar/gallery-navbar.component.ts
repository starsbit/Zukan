import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';

import { GallerySearchState } from '../gallery-search.models';
import { GallerySearchBarComponent } from '../gallery-search-bar/gallery-search-bar.component';
import { GallerySearchOptionsDialogComponent } from '../gallery-search-options-dialog/gallery-search-options-dialog.component';
import { GallerySettingsDialogComponent } from '../gallery-settings-dialog/gallery-settings-dialog.component';
import { countActiveAdvancedFilters, createDefaultGallerySearchFilters } from '../gallery-search.utils';
import { ThemeService } from '../../../services/theme.service';

@Component({
  selector: 'app-gallery-navbar',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatToolbarModule,
    GallerySearchBarComponent
  ],
  templateUrl: './gallery-navbar.component.html',
  styleUrl: './gallery-navbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryNavbarComponent {
  private readonly dialog = inject(MatDialog);
  readonly themeService = inject(ThemeService);

  @Input({ required: true }) searchState!: GallerySearchState;
  @Input() isTrashView = false;
  @Input() albumSelectionEnabled = true;
  @Input() showPrimaryAction = true;
  @Output() readonly searchApplied = new EventEmitter<GallerySearchState>();
  @Output() readonly settingsSaved = new EventEmitter<void>();
  @Output() readonly uploadRequested = new EventEmitter<void>();
  @Output() readonly emptyTrashRequested = new EventEmitter<void>();

  get activeFilterCount(): number {
    return countActiveAdvancedFilters(this.searchState.filters);
  }

  applySearch(searchText: string): void {
    this.searchApplied.emit({
      ...this.searchState,
      searchText
    });
  }

  clearSearch(): void {
    this.searchApplied.emit({
      searchText: '',
      filters: createDefaultGallerySearchFilters()
    });
  }

  openFilters(): void {
    const dialogRef = this.dialog.open(GallerySearchOptionsDialogComponent, {
      width: '680px',
      maxWidth: 'calc(100vw - 2rem)',
      data: {
        filters: this.searchState.filters,
        albumSelectionEnabled: this.albumSelectionEnabled
      }
    });

    dialogRef.afterClosed().subscribe((filters) => {
      if (!filters) {
        return;
      }

      this.searchApplied.emit({
        searchText: this.searchState.searchText,
        filters
      });
    });
  }

  openSettings(): void {
    const dialogRef = this.dialog.open(GallerySettingsDialogComponent, {
      width: '420px',
      maxWidth: 'calc(100vw - 2rem)'
    });

    dialogRef.afterClosed().subscribe((saved) => {
      if (saved) {
        this.settingsSaved.emit();
      }
    });
  }

  toggleTheme(): void {
    this.themeService.toggleMode();
  }
}
