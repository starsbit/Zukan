import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
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
import { TagRead } from '../../../models/tags';
import { TagsClientService } from '../../../services/web/tags-client.service';
import { formatMetadataName, normalizeMetadataNameForSubmission } from '../../../utils/media-display.utils';

export interface TagMergeDialogData {
  sourceTag: TagRead;
}

@Component({
  selector: 'zukan-tag-merge-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './tag-merge-dialog.component.html',
  styleUrl: './tag-merge-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagMergeDialogComponent {
  protected readonly data = inject<TagMergeDialogData>(MAT_DIALOG_DATA);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef<TagMergeDialogComponent, TagRead | null>);
  private readonly tagsClient = inject(TagsClientService);

  readonly targetQuery = new FormControl('', { nonNullable: true });
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly suggestions = signal<TagRead[]>([]);
  readonly selectedTag = signal<TagRead | null>(null);
  readonly pendingSelectedName = signal<string | null>(null);
  readonly canSubmit = computed(() => this.selectedTag() !== null);
  readonly sourceLabel = computed(() => 'Replace this tag');
  readonly targetLabel = computed(() => 'Keep this tag');
  readonly actionLabel = computed(() => {
    const selected = this.selectedTag();
    return selected
      ? `Merge into ${this.displayMetadataName(selected.name)}`
      : 'Merge tag';
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
        const selectedName = this.selectedTag()?.name ?? this.pendingSelectedName();
        if (selectedName && normalizedQuery === selectedName) {
          this.pendingSelectedName.set(null);
          this.loading.set(false);
          return of(null);
        }

        this.pendingSelectedName.set(null);
        this.selectedTag.set(null);
        if (!query) {
          this.loading.set(false);
          return of(null);
        }

        this.loading.set(true);
        return this.tagsClient.list({
          q: query,
          page_size: 8,
          sort_by: 'media_count',
          sort_order: 'desc',
          scope: 'owner',
        });
      }),
    ).subscribe({
      next: (page) => {
        this.loading.set(false);
        this.suggestions.set(
          page?.items.filter((tag) => tag.id !== this.data.sourceTag.id) ?? [],
        );
      },
      error: (err) => {
        this.loading.set(false);
        this.suggestions.set([]);
        if (this.selectedTag() || this.pendingSelectedName()) {
          this.error.set(null);
          return;
        }
        this.error.set(err.error?.detail ?? 'Unable to load target tags.');
      },
    });
  }

  protected onOptionSelected(event: MatAutocompleteSelectedEvent): void {
    const selected = this.suggestions().find((tag) => tag.id === event.option.value) ?? null;
    this.pendingSelectedName.set(selected?.name ?? null);
    this.selectedTag.set(selected);
    this.error.set(null);
    if (selected) {
      this.targetQuery.setValue(selected.name, { emitEvent: false });
    }
  }

  protected clearSelected(): void {
    this.selectedTag.set(null);
    this.targetQuery.setValue('', { emitEvent: true });
  }

  protected cancel(): void {
    this.dialogRef.close(null);
  }

  protected confirm(): void {
    this.dialogRef.close(this.selectedTag());
  }

  protected displayMetadataName(value: string): string {
    return formatMetadataName(value);
  }

  protected mergePreviewLines(selected: TagRead): string[] {
    const sourceName = this.displayMetadataName(this.data.sourceTag.name);
    const targetName = this.displayMetadataName(selected.name);

    return [
      `${this.data.sourceTag.media_count} media using "${sourceName}" will use "${targetName}" instead.`,
      `"${targetName}" will stay as the tag you keep.`,
      `"${sourceName}" will be removed if nothing still uses this tag.`,
    ];
  }
}
