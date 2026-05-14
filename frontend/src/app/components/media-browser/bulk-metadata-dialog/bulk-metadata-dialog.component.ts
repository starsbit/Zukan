import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { CharacterSuggestion, SeriesSuggestion, TagRead } from '../../../models/tags';
import { MediaClientService } from '../../../services/web/media-client.service';
import { TagsClientService } from '../../../services/web/tags-client.service';
import { commaSeparatedPasteValues } from '../../../utils/comma-separated-paste.utils';
import { formatMetadataName, normalizeMetadataNameForSubmission } from '../../../utils/media-display.utils';

export interface BulkMetadataDialogData {
  selectedCount: number;
}

export interface BulkMetadataDialogResult {
  add_tags: string[];
  remove_tags: string[];
  add_character_names: string[];
  remove_character_names: string[];
  add_series_names: string[];
  remove_series_names: string[];
}

type BulkMetadataFieldKey =
  | 'add_tags'
  | 'remove_tags'
  | 'add_character_names'
  | 'remove_character_names'
  | 'add_series_names'
  | 'remove_series_names';

interface BulkMetadataField {
  key: BulkMetadataFieldKey;
  label: string;
  placeholder: string;
}

@Component({
  selector: 'zukan-bulk-metadata-dialog',
  standalone: true,
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  templateUrl: './bulk-metadata-dialog.component.html',
  styleUrl: './bulk-metadata-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BulkMetadataDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<BulkMetadataDialogComponent>);
  private readonly data = inject<BulkMetadataDialogData>(MAT_DIALOG_DATA);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mediaClient = inject(MediaClientService);
  private readonly tagsClient = inject(TagsClientService);

  readonly selectedCount = this.data.selectedCount;
  readonly addFields: BulkMetadataField[] = [
    { key: 'add_tags', label: 'Tags', placeholder: 'Add tags...' },
    { key: 'add_character_names', label: 'Characters', placeholder: 'Add character names...' },
    { key: 'add_series_names', label: 'Series', placeholder: 'Add series names...' },
  ];
  readonly removeFields: BulkMetadataField[] = [
    { key: 'remove_tags', label: 'Tags', placeholder: 'Remove tags...' },
    { key: 'remove_character_names', label: 'Characters', placeholder: 'Remove character names...' },
    { key: 'remove_series_names', label: 'Series', placeholder: 'Remove series names...' },
  ];

  readonly controls: Record<BulkMetadataFieldKey, FormControl<string>> = {
    add_tags: new FormControl('', { nonNullable: true }),
    remove_tags: new FormControl('', { nonNullable: true }),
    add_character_names: new FormControl('', { nonNullable: true }),
    remove_character_names: new FormControl('', { nonNullable: true }),
    add_series_names: new FormControl('', { nonNullable: true }),
    remove_series_names: new FormControl('', { nonNullable: true }),
  };
  readonly chips = signal<Record<BulkMetadataFieldKey, string[]>>({
    add_tags: [],
    remove_tags: [],
    add_character_names: [],
    remove_character_names: [],
    add_series_names: [],
    remove_series_names: [],
  });
  readonly suggestions = signal<Record<BulkMetadataFieldKey, string[]>>({
    add_tags: [],
    remove_tags: [],
    add_character_names: [],
    remove_character_names: [],
    add_series_names: [],
    remove_series_names: [],
  });

  constructor() {
    (Object.keys(this.controls) as BulkMetadataFieldKey[]).forEach((key) => {
      this.controls[key].valueChanges.pipe(
        takeUntilDestroyed(this.destroyRef),
        debounceTime(150),
        distinctUntilChanged(),
        switchMap((value) => this.fetchSuggestions(key, value)),
      ).subscribe((values) => {
        this.suggestions.update((current) => ({ ...current, [key]: this.filterExisting(key, values) }));
      });
    });
  }

  controlFor(key: BulkMetadataFieldKey): FormControl<string> {
    return this.controls[key];
  }

  chipsFor(key: BulkMetadataFieldKey): string[] {
    return this.chips()[key];
  }

  suggestionsFor(key: BulkMetadataFieldKey): string[] {
    return this.suggestions()[key];
  }

  addChip(key: BulkMetadataFieldKey, value: string): void {
    const cleaned = value.trim();
    if (!cleaned) {
      return;
    }
    const normalized = this.normalizedKey(key, cleaned);
    this.chips.update((current) => {
      const existing = current[key];
      if (existing.some((chip) => this.normalizedKey(key, chip) === normalized)) {
        return current;
      }
      return { ...current, [key]: [...existing, cleaned] };
    });
    this.controls[key].reset('');
    this.suggestions.update((current) => ({ ...current, [key]: [] }));
  }

  removeChip(key: BulkMetadataFieldKey, value: string): void {
    this.chips.update((current) => ({
      ...current,
      [key]: current[key].filter((chip) => chip !== value),
    }));
  }

  onInputEnter(key: BulkMetadataFieldKey): void {
    this.addChip(key, this.controls[key].value);
  }

  onInputPaste(key: BulkMetadataFieldKey, event: ClipboardEvent): void {
    const values = commaSeparatedPasteValues(event);
    if (values === null) {
      return;
    }
    event.preventDefault();
    values.forEach((value) => this.addChip(key, value));
    this.controls[key].reset('', { emitEvent: false });
    this.suggestions.update((current) => ({ ...current, [key]: [] }));
  }

  onOptionSelected(key: BulkMetadataFieldKey, event: MatAutocompleteSelectedEvent): void {
    this.addChip(key, event.option.value as string);
  }

  hasChanges(): boolean {
    return Object.values(this.chips()).some((values) => values.length > 0);
  }

  hasConflicts(): boolean {
    return this.hasFieldConflict('tags') || this.hasFieldConflict('character_names') || this.hasFieldConflict('series_names');
  }

  canApply(): boolean {
    return this.hasChanges() && !this.hasConflicts();
  }

  apply(): void {
    if (!this.canApply()) {
      return;
    }
    this.dialogRef.close(this.chips());
  }

  cancel(): void {
    this.dialogRef.close();
  }

  displayMetadataName(value: string): string {
    return formatMetadataName(value);
  }

  private fetchSuggestions(key: BulkMetadataFieldKey, value: string) {
    const query = value.trim();
    if (!query) {
      return of([] as string[]);
    }
    if (key.endsWith('tags')) {
      return this.tagsClient.list({ q: query, page_size: 8 }).pipe(
        switchMap((response) => of(response.items.map((tag: TagRead) => tag.name))),
      );
    }
    if (key.endsWith('character_names')) {
      return this.mediaClient.getCharacterSuggestions(query, 8, 'accessible').pipe(
        switchMap((items) => of(items.map((item: CharacterSuggestion) => item.name))),
      );
    }
    return this.mediaClient.getSeriesSuggestions(query, 8, 'accessible').pipe(
      switchMap((items) => of(items.map((item: SeriesSuggestion) => item.name))),
    );
  }

  private filterExisting(key: BulkMetadataFieldKey, values: string[]): string[] {
    const existing = new Set(this.chips()[key].map((chip) => this.normalizedKey(key, chip)));
    return values.filter((value) => !existing.has(this.normalizedKey(key, value)));
  }

  private hasFieldConflict(field: 'tags' | 'character_names' | 'series_names'): boolean {
    const addKey = `add_${field}` as BulkMetadataFieldKey;
    const removeKey = `remove_${field}` as BulkMetadataFieldKey;
    const addKeys = new Set(this.chips()[addKey].map((value) => this.normalizedKey(addKey, value)));
    return this.chips()[removeKey].some((value) => addKeys.has(this.normalizedKey(removeKey, value)));
  }

  private normalizedKey(key: BulkMetadataFieldKey, value: string): string {
    if (key.endsWith('tags')) {
      return normalizeMetadataNameForSubmission(value) || this.normalizeSearchKey(value);
    }
    return this.normalizeSearchKey(value);
  }

  private normalizeSearchKey(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
}
