import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { MediaType, MediaVisibility, NsfwFilter, SensitiveFilter, TagFilterMode, TaggingStatus } from '../../../../models/media';
import { AdvancedSearchFilters } from '../../../../services/navbar-search.service';
import { TagsClientService } from '../../../../services/web/tags-client.service';
import { formatMetadataName } from '../../../../utils/media-display.utils';

interface SearchFilterDialogData {
  filters: AdvancedSearchFilters;
}

type FavoriteFilterOption = 'any' | 'only' | 'exclude';

@Component({
  selector: 'zukan-search-filters-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './search-filters-dialog.component.html',
  styleUrl: './search-filters-dialog.component.scss',
})
export class SearchFiltersDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<SearchFiltersDialogComponent>);
  private readonly data = inject<SearchFilterDialogData>(MAT_DIALOG_DATA);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly tagsClient = inject(TagsClientService);

  readonly statusOptions: Array<{ value: TaggingStatus | null; label: string }> = [
    { value: null, label: 'Any' },
    { value: TaggingStatus.PENDING, label: 'Pending' },
    { value: TaggingStatus.PROCESSING, label: 'Processing' },
    { value: TaggingStatus.DONE, label: 'Done' },
    { value: TaggingStatus.FAILED, label: 'Failed' },
  ];
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
  readonly sensitiveOptions = [
    { value: null, label: 'Default' },
    { value: SensitiveFilter.DEFAULT, label: 'Respect user setting' },
    { value: SensitiveFilter.INCLUDE, label: 'Include sensitive' },
    { value: SensitiveFilter.ONLY, label: 'Only sensitive' },
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
    { value: 'uploaded_at', label: 'Uploaded date' },
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

  readonly excludeTagChips = signal<string[]>([...this.data.filters.excludeTags]);
  readonly excludeTagInput = new FormControl('', { nonNullable: true });
  readonly excludeTagSuggestions = signal<string[]>([]);

  readonly form = this.fb.group({
    mode: [this.data.filters.mode],
    nsfw: [this.data.filters.nsfw],
    sensitive: [this.data.filters.sensitive],
    status: [this.data.filters.status ?? null],
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
    uploadedYear: [this.data.filters.uploadedYear?.toString() ?? ''],
    uploadedMonth: [this.data.filters.uploadedMonth?.toString() ?? ''],
    uploadedDay: [this.data.filters.uploadedDay?.toString() ?? ''],
    uploadedAfter: [this.data.filters.uploadedAfter ?? ''],
    uploadedBefore: [this.data.filters.uploadedBefore ?? ''],
    uploadedBeforeYear: [this.data.filters.uploadedBeforeYear?.toString() ?? ''],
  });

  constructor() {
    this.excludeTagInput.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef),
      debounceTime(150),
      distinctUntilChanged(),
      switchMap((value) => {
        const query = value.trim();
        if (!query) {
          return of({ items: [] as { name: string }[] });
        }
        return this.tagsClient.list({ q: query, page_size: 8 });
      }),
    ).subscribe(({ items }) => {
      const existing = new Set(this.excludeTagChips().map((t) => t.toLowerCase()));
      this.excludeTagSuggestions.set(
        items
          .filter((tag) => !existing.has(tag.name.toLowerCase()))
          .map((tag) => tag.name),
      );
    });
  }

  addExcludeTag(value: string): void {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    const lower = normalized.toLowerCase();
    this.excludeTagChips.update((chips) =>
      chips.some((c) => c.toLowerCase() === lower) ? chips : [...chips, normalized],
    );
    this.excludeTagInput.reset('');
    this.excludeTagSuggestions.set([]);
  }

  removeExcludeTag(tag: string): void {
    this.excludeTagChips.update((chips) => chips.filter((c) => c !== tag));
  }

  onExcludeTagSelected(event: MatAutocompleteSelectedEvent): void {
    this.addExcludeTag(event.option.value as string);
  }

  onExcludeTagInputEnter(): void {
    this.addExcludeTag(this.excludeTagInput.value);
  }

  protected displayMetadataName(value: string): string {
    return formatMetadataName(value);
  }

  apply(): void {
    const value = this.form.getRawValue();
    this.dialogRef.close({
      excludeTags: this.excludeTagChips(),
      mode: value.mode ?? null,
      nsfw: value.nsfw ?? null,
      sensitive: value.sensitive ?? null,
      status: value.status ?? null,
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
      uploadedYear: this.parseInteger(value.uploadedYear ?? ''),
      uploadedMonth: this.parseInteger(value.uploadedMonth ?? ''),
      uploadedDay: this.parseInteger(value.uploadedDay ?? ''),
      uploadedAfter: (value.uploadedAfter ?? '').trim() || null,
      uploadedBefore: (value.uploadedBefore ?? '').trim() || null,
      uploadedBeforeYear: this.parseInteger(value.uploadedBeforeYear ?? ''),
    } satisfies AdvancedSearchFilters);
  }

  clear(): void {
    this.excludeTagChips.set([]);
    this.excludeTagInput.reset('');
    this.dialogRef.close({
      excludeTags: [],
      mode: null,
      nsfw: null,
      sensitive: null,
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
      uploadedYear: null,
      uploadedMonth: null,
      uploadedDay: null,
      uploadedAfter: null,
      uploadedBefore: null,
      uploadedBeforeYear: null,
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
