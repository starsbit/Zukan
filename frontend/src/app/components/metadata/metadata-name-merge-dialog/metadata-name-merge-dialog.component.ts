import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { MetadataNameRead } from '../../../models/tags';
import { TagsClientService } from '../../../services/web/tags-client.service';
import { formatMetadataName, normalizeMetadataNameForSubmission } from '../../../utils/media-display.utils';

export interface MetadataNameMergeDialogData {
  kind: 'characters' | 'series';
  sourceName: string;
  mediaCount: number;
}

@Component({
  selector: 'zukan-metadata-name-merge-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TitleCasePipe,
    MatAutocompleteModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './metadata-name-merge-dialog.component.html',
  styleUrl: './metadata-name-merge-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetadataNameMergeDialogComponent {
  protected readonly data = inject<MetadataNameMergeDialogData>(MAT_DIALOG_DATA);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef<MetadataNameMergeDialogComponent, MetadataNameRead | null>);
  private readonly tagsClient = inject(TagsClientService);

  readonly targetQuery = new FormControl('', { nonNullable: true });
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly suggestions = signal<MetadataNameRead[]>([]);
  readonly selectedItem = signal<MetadataNameRead | null>(null);
  readonly pendingSelectedName = signal<string | null>(null);
  readonly canSubmit = computed(() => this.selectedItem() !== null);
  readonly kindLabel = computed(() => this.data.kind === 'characters' ? 'character' : 'series');
  readonly pluralLabel = computed(() => this.data.kind === 'characters' ? 'characters' : 'series');
  readonly sourceLabel = computed(() => `Replace this ${this.kindLabel()}`);
  readonly targetLabel = computed(() => `Keep this ${this.kindLabel()}`);
  readonly actionLabel = computed(() => {
    const selected = this.selectedItem();
    return selected
      ? `Merge into ${this.displayMetadataName(selected.name)}`
      : `Merge ${this.kindLabel()}`;
  });

  constructor() {
    this.targetQuery.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef),
      debounceTime(180),
      distinctUntilChanged(),
      switchMap((value) => {
        const query = value.trim();
        this.error.set(null);
        const normalizedQuery = normalizeMetadataNameForSubmission(query);
        const selectedName = this.selectedItem()?.name ?? this.pendingSelectedName();
        if (selectedName && normalizedQuery === selectedName) {
          this.pendingSelectedName.set(null);
          this.loading.set(false);
          return of(null);
        }

        this.pendingSelectedName.set(null);
        this.selectedItem.set(null);
        if (!query) {
          this.loading.set(false);
          return of(null);
        }

        this.loading.set(true);
        const request = this.data.kind === 'characters'
          ? this.tagsClient.listCharacterNames({
              q: query,
              page_size: 8,
              sort_by: 'media_count',
              sort_order: 'desc',
              scope: 'owner',
            })
          : this.tagsClient.listSeriesNames({
              q: query,
              page_size: 8,
              sort_by: 'media_count',
              sort_order: 'desc',
              scope: 'owner',
            });
        return request;
      }),
    ).subscribe({
      next: (page) => {
        this.loading.set(false);
        this.suggestions.set(
          page?.items.filter((item: MetadataNameRead) => item.name !== this.data.sourceName) ?? [],
        );
      },
      error: (err) => {
        this.loading.set(false);
        this.suggestions.set([]);
        this.error.set(err.error?.detail ?? `Unable to load target ${this.pluralLabel()}.`);
      },
    });
  }

  protected onOptionSelected(event: MatAutocompleteSelectedEvent): void {
    const selected = this.suggestions().find((item) => item.name === event.option.value) ?? null;
    this.pendingSelectedName.set(selected?.name ?? null);
    this.selectedItem.set(selected);
    if (selected) {
      this.targetQuery.setValue(selected.name, { emitEvent: false });
    }
  }

  protected clearSelected(): void {
    this.selectedItem.set(null);
    this.targetQuery.setValue('', { emitEvent: true });
  }

  protected cancel(): void {
    this.dialogRef.close(null);
  }

  protected confirm(): void {
    this.dialogRef.close(this.selectedItem());
  }

  protected displayMetadataName(value: string): string {
    return formatMetadataName(value);
  }

  protected mergePreviewLines(selected: MetadataNameRead): string[] {
    const sourceName = this.displayMetadataName(this.data.sourceName);
    const targetName = this.displayMetadataName(selected.name);
    const noun = this.kindLabel();

    return [
      `${this.data.mediaCount} media using "${sourceName}" will use "${targetName}" instead.`,
      `"${targetName}" will stay as the name you keep.`,
      `"${sourceName}" will be removed if nothing still uses this ${noun}.`,
    ];
  }
}
