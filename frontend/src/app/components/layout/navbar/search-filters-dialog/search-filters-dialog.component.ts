import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MediaType, MediaVisibility, NsfwFilter, TagFilterMode } from '../../../../models/media';
import { AdvancedSearchFilters } from '../../../../services/navbar-search.service';

interface SearchFilterDialogData {
  filters: AdvancedSearchFilters;
}

type FavoriteFilterOption = 'any' | 'only' | 'exclude';

@Component({
  selector: 'zukan-search-filters-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './search-filters-dialog.component.html',
  styleUrl: './search-filters-dialog.component.scss',
})
export class SearchFiltersDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<SearchFiltersDialogComponent>);
  private readonly data = inject<SearchFilterDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);

  readonly modeOptions = [
    { value: null, label: 'Default' },
    { value: TagFilterMode.AND, label: 'Match all tags' },
    { value: TagFilterMode.OR, label: 'Match any tag' },
  ];
  readonly nsfwOptions = [
    { value: null, label: 'Default' },
    { value: NsfwFilter.DEFAULT, label: 'Respect user setting' },
    { value: NsfwFilter.INCLUDE, label: 'Include NSFW' },
    { value: NsfwFilter.ONLY, label: 'Only NSFW' },
  ];
  readonly visibilityOptions = [
    { value: null, label: 'Any visibility' },
    { value: MediaVisibility.PRIVATE, label: 'Private' },
    { value: MediaVisibility.PUBLIC, label: 'Public' },
  ];
  readonly favoriteOptions: Array<{ value: FavoriteFilterOption; label: string }> = [
    { value: 'any', label: 'Any media' },
    { value: 'only', label: 'Only favorites' },
    { value: 'exclude', label: 'Exclude favorites' },
  ];
  readonly sortByOptions: Array<{ value: AdvancedSearchFilters['sortBy']; label: string }> = [
    { value: null, label: 'Default' },
    { value: 'captured_at', label: 'Captured date' },
    { value: 'created_at', label: 'Created date' },
    { value: 'filename', label: 'Filename' },
    { value: 'file_size', label: 'File size' },
  ];
  readonly sortOrderOptions: Array<{ value: AdvancedSearchFilters['sortOrder']; label: string }> = [
    { value: null, label: 'Default' },
    { value: 'desc', label: 'Descending' },
    { value: 'asc', label: 'Ascending' },
  ];
  readonly mediaTypeOptions = [
    { value: MediaType.IMAGE, label: 'Images' },
    { value: MediaType.GIF, label: 'GIFs' },
    { value: MediaType.VIDEO, label: 'Videos' },
  ];

  readonly form = this.fb.group({
    excludeTags: [this.data.filters.excludeTags.join(', ')],
    mode: [this.data.filters.mode],
    nsfw: [this.data.filters.nsfw],
    status: [this.data.filters.status ?? ''],
    favorited: [this.favoriteValueFromBoolean(this.data.filters.favorited)],
    visibility: [this.data.filters.visibility],
    mediaTypes: [this.data.filters.mediaTypes],
    sortBy: [this.data.filters.sortBy],
    sortOrder: [this.data.filters.sortOrder],
    capturedYear: [this.data.filters.capturedYear?.toString() ?? ''],
    capturedMonth: [this.data.filters.capturedMonth?.toString() ?? ''],
    capturedDay: [this.data.filters.capturedDay?.toString() ?? ''],
    capturedAfter: [this.data.filters.capturedAfter ?? ''],
    capturedBefore: [this.data.filters.capturedBefore ?? ''],
    capturedBeforeYear: [this.data.filters.capturedBeforeYear?.toString() ?? ''],
  });

  apply(): void {
    const value = this.form.getRawValue();
    const excludeTags = (value.excludeTags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    this.dialogRef.close({
      excludeTags,
      mode: value.mode ?? null,
      nsfw: value.nsfw ?? null,
      status: (value.status ?? '').trim() || null,
      favorited: this.favoriteBooleanFromValue(value.favorited ?? 'any'),
      visibility: value.visibility ?? null,
      mediaTypes: value.mediaTypes ?? [],
      sortBy: value.sortBy ?? null,
      sortOrder: value.sortOrder ?? null,
      capturedYear: this.parseInteger(value.capturedYear ?? ''),
      capturedMonth: this.parseInteger(value.capturedMonth ?? ''),
      capturedDay: this.parseInteger(value.capturedDay ?? ''),
      capturedAfter: (value.capturedAfter ?? '').trim() || null,
      capturedBefore: (value.capturedBefore ?? '').trim() || null,
      capturedBeforeYear: this.parseInteger(value.capturedBeforeYear ?? ''),
    } satisfies AdvancedSearchFilters);
  }

  clear(): void {
    this.dialogRef.close({
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
    } satisfies AdvancedSearchFilters);
  }

  private favoriteValueFromBoolean(value: boolean | null): FavoriteFilterOption {
    if (value === true) {
      return 'only';
    }

    if (value === false) {
      return 'exclude';
    }

    return 'any';
  }

  private favoriteBooleanFromValue(value: FavoriteFilterOption): boolean | null {
    if (value === 'only') {
      return true;
    }

    if (value === 'exclude') {
      return false;
    }

    return null;
  }

  private parseInteger(value: string | number): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Math.trunc(value) : null;
    }

    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
