import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatMenuModule } from '@angular/material/menu';

import { MediaSearchState } from './media-search.models';
import { MediaSearchBarComponent } from './media-search-bar.component';
import { MediaSearchOptionsDialogComponent } from './media-search-options-dialog.component';
import { MediaSettingsDialogComponent } from './media-settings-dialog.component';
import { countActiveAdvancedFilters, createDefaultMediaSearchFilters } from './media-search.utils';
import { ThemeService } from '../../services/theme.service';
import { createResponsiveDialogConfig, createResponsiveDialogConfigWithoutData } from '../../utils/dialog-config.utils';

@Component({
  selector: 'app-media-navbar',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatToolbarModule,
    MatMenuModule,
    MediaSearchBarComponent
  ],
  templateUrl: './media-navbar.component.html',
  styleUrl: './media-navbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MediaNavbarComponent {
  private readonly dialog = inject(MatDialog);
  readonly themeService = inject(ThemeService);

  @Input({ required: true }) searchState!: MediaSearchState;
  @Input() isTrashView = false;
  @Input() albumSelectionEnabled = true;
  @Input() showPrimaryAction = true;
  @Output() readonly searchApplied = new EventEmitter<MediaSearchState>();
  @Output() readonly settingsSaved = new EventEmitter<void>();
  @Output() readonly uploadRequested = new EventEmitter<void>();
  @Output() readonly uploadFilesRequested = new EventEmitter<void>();
  @Output() readonly uploadFolderRequested = new EventEmitter<void>();
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
      filters: createDefaultMediaSearchFilters()
    });
  }

  openFilters(): void {
    const dialogRef = this.dialog.open(MediaSearchOptionsDialogComponent, createResponsiveDialogConfig({
      data: {
        filters: this.searchState.filters,
        albumSelectionEnabled: this.albumSelectionEnabled
      }
    }, '680px'));

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
    const dialogRef = this.dialog.open(MediaSettingsDialogComponent, createResponsiveDialogConfigWithoutData('420px'));

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
