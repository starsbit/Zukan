import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ImportBatchReviewItemRead } from '../../../../models/processing';
import { CharacterSuggestion, SeriesSuggestion } from '../../../../models/tags';
import { MediaService } from '../../../../services/media.service';
import { UploadTrackerService } from '../../../../services/upload-tracker.service';
import { BatchesClientService } from '../../../../services/web/batches-client.service';
import { UploadStatusPreviewComponent } from '../upload-status-preview/upload-status-preview.component';
import { MediaInspectorDialogComponent } from '../../../media-browser/media-inspector-dialog/media-inspector-dialog.component';

type ReviewFilter = 'all' | 'missing_character' | 'missing_series' | 'missing_both';

export interface UploadReviewDialogData {
  batchId: string;
}

@Component({
  selector: 'zukan-upload-review-dialog',
  standalone: true,
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    ReactiveFormsModule,
    UploadStatusPreviewComponent,
  ],
  templateUrl: './upload-review-dialog.component.html',
  styleUrl: './upload-review-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadReviewDialogComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef<UploadReviewDialogComponent>);
  private readonly dialog = inject(MatDialog);
  private readonly data = inject<UploadReviewDialogData>(MAT_DIALOG_DATA);
  private readonly tracker = inject(UploadTrackerService);
  private readonly mediaService = inject(MediaService);
  private readonly batchesClient = inject(BatchesClientService);
  private readonly snackBar = inject(MatSnackBar);

  readonly filter = signal<ReviewFilter>('all');
  readonly selectedIds = signal<string[]>([]);
  readonly saving = signal(false);
  readonly characterInputControl = new FormControl('', { nonNullable: true });
  readonly seriesInputControl = new FormControl('', { nonNullable: true });
  readonly characterNames = signal<string[]>([]);
  readonly seriesNames = signal<string[]>([]);
  readonly characterSuggestions = signal<CharacterSuggestion[]>([]);
  readonly seriesSuggestions = signal<SeriesSuggestion[]>([]);
  readonly remoteItems = signal<ImportBatchReviewItemRead[]>([]);
  readonly remoteRefreshing = signal(false);
  readonly remoteBaselineTotal = signal(0);

  readonly reviewState = computed(() => this.tracker.getBatchReview(this.data.batchId));
  readonly items = computed(() => this.reviewState()?.reviewItems ?? this.remoteItems());
  readonly baselineTotal = computed(() => this.reviewState()?.reviewBaselineTotal ?? this.remoteBaselineTotal());
  readonly reviewedCount = computed(() => Math.max(this.baselineTotal() - this.items().length, 0));
  readonly visibleItems = computed(() => {
    switch (this.filter()) {
      case 'missing_character':
        return this.items().filter((item) => item.missing_character && !item.missing_series);
      case 'missing_series':
        return this.items().filter((item) => !item.missing_character && item.missing_series);
      case 'missing_both':
        return this.items().filter((item) => item.missing_character && item.missing_series);
      default:
        return this.items();
    }
  });
  readonly selectedCount = computed(() => {
    const visibleIds = new Set(this.visibleItems().map((item) => item.media.id));
    return this.selectedIds().filter((id) => visibleIds.has(id)).length;
  });
  readonly canApply = computed(() =>
    !this.saving()
    && this.selectedIds().length > 0
    && (this.characterNames().length > 0 || this.seriesNames().length > 0),
  );

  constructor() {
    effect(() => {
      const currentIds = new Set(this.items().map((item) => item.media.id));
      const nextSelection = this.selectedIds().filter((id) => currentIds.has(id));
      if (nextSelection.length !== this.selectedIds().length) {
        this.selectedIds.set(nextSelection);
      }
    });

    this.characterInputControl.valueChanges.pipe(
      debounceTime(150),
      distinctUntilChanged(),
      switchMap((value) => {
        const query = value.trim();
        return query ? this.mediaService.getCharacterSuggestions(query, 8) : of([]);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((items) => this.characterSuggestions.set(items));

    this.seriesInputControl.valueChanges.pipe(
      debounceTime(150),
      distinctUntilChanged(),
      switchMap((value) => {
        const query = value.trim();
        return query ? this.mediaService.getSeriesSuggestions(query, 8) : of([]);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((items) => this.seriesSuggestions.set(items));

    this.refreshReview();
  }

  close(): void {
    this.dialogRef.close();
  }

  toggleSelected(mediaId: string): void {
    this.selectedIds.update((ids) =>
      ids.includes(mediaId) ? ids.filter((id) => id !== mediaId) : [...ids, mediaId],
    );
  }

  isSelected(mediaId: string): boolean {
    return this.selectedIds().includes(mediaId);
  }

  selectAllVisible(): void {
    const visibleIds = this.visibleItems().map((item) => item.media.id);
    this.selectedIds.update((ids) => Array.from(new Set([...ids, ...visibleIds])));
  }

  clearSelection(): void {
    this.selectedIds.set([]);
  }

  addCharacter(value?: string): void {
    this.commitName(this.characterNames, value ?? this.characterInputControl.getRawValue());
    this.characterInputControl.setValue('', { emitEvent: false });
    this.characterSuggestions.set([]);
  }

  addSeries(value?: string): void {
    this.commitName(this.seriesNames, value ?? this.seriesInputControl.getRawValue());
    this.seriesInputControl.setValue('', { emitEvent: false });
    this.seriesSuggestions.set([]);
  }

  removeCharacter(value: string): void {
    this.characterNames.update((items) => items.filter((item) => item !== value));
  }

  removeSeries(value: string): void {
    this.seriesNames.update((items) => items.filter((item) => item !== value));
  }

  applySelected(): void {
    if (!this.canApply()) {
      return;
    }

    this.saving.set(true);
    this.mediaService.batchUpdateEntities({
      media_ids: this.selectedIds(),
      character_names: this.characterNames().length > 0 ? this.characterNames() : undefined,
      series_names: this.seriesNames().length > 0 ? this.seriesNames() : undefined,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.selectedIds.set([]);
        this.characterNames.set([]);
        this.seriesNames.set([]);
        this.saving.set(false);
        this.refreshReview();
        this.snackBar.open('Names applied to selected media.', 'Close', { duration: 3000 });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Could not apply names to selected media.', 'Close', { duration: 4000 });
      },
    });
  }

  openInspector(item: ImportBatchReviewItemRead): void {
    this.dialog.open(MediaInspectorDialogComponent, {
      data: {
        items: this.items().map((entry) => entry.media),
        activeMediaId: item.media.id,
      },
      width: '100vw',
      maxWidth: '100vw',
      height: '100vh',
      maxHeight: '100vh',
      autoFocus: false,
      panelClass: 'media-inspector-dialog-panel',
    });
  }

  badgeLabel(item: ImportBatchReviewItemRead): string {
    if (item.missing_character && item.missing_series) {
      return 'Missing character + series';
    }
    if (item.missing_character) {
      return 'Missing character';
    }
    return 'Missing series';
  }

  characterLabel(item: ImportBatchReviewItemRead): string {
    return this.entityLabel(item, 'character');
  }

  seriesLabel(item: ImportBatchReviewItemRead): string {
    return this.entityLabel(item, 'series');
  }

  trackByMediaId(_: number, item: ImportBatchReviewItemRead): string {
    return item.media.id;
  }

  private refreshReview(): void {
    if (this.reviewState()) {
      this.tracker.refreshBatchReview(this.data.batchId);
      return;
    }

    this.remoteRefreshing.set(true);
    this.batchesClient.listReviewItems(this.data.batchId).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (response) => {
        this.remoteItems.set(response.items);
        this.remoteBaselineTotal.update((current) => Math.max(current, response.total));
        this.remoteRefreshing.set(false);
      },
      error: () => {
        this.remoteRefreshing.set(false);
      },
    });
  }

  private commitName(target: { update(fn: (items: string[]) => string[]): void }, rawValue: string): void {
    const normalized = normalizeChipValue(rawValue);
    if (!normalized) {
      return;
    }
    target.update((items) => items.includes(normalized) ? items : [...items, normalized]);
  }

  private entityLabel(item: ImportBatchReviewItemRead, entityType: 'character' | 'series'): string {
    const names = item.entities
      .filter((entity) => entity.entity_type === entityType)
      .map((entity) => entity.name);
    return names.length > 0 ? names.join(', ') : 'None';
  }
}

function normalizeChipValue(rawValue: string): string {
  return rawValue.trim().replace(/\s+/g, ' ');
}
