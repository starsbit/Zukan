import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';

import { GallerySearchState } from '../gallery-search.models';
import { GallerySearchBarComponent } from '../gallery-search-bar/gallery-search-bar.component';
import { GallerySearchOptionsDialogComponent } from '../gallery-search-options-dialog/gallery-search-options-dialog.component';
import { countActiveAdvancedFilters, createDefaultGallerySearchFilters } from '../gallery-search.utils';

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

  @Input({ required: true }) searchState!: GallerySearchState;
  @Output() readonly searchApplied = new EventEmitter<GallerySearchState>();
  @Output() readonly refreshRequested = new EventEmitter<void>();
  @Output() readonly uploadRequested = new EventEmitter<void>();

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
      data: this.searchState.filters
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
}
