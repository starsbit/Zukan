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
import { debounceTime, distinctUntilChanged, finalize, of, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ImportBatchRecommendationGroupRead,
  ImportBatchReviewItemRead,
} from '../../../../models/processing';
import { CharacterSuggestion, SeriesSuggestion } from '../../../../models/tags';
import { MediaService } from '../../../../services/media.service';
import { UploadTrackerService } from '../../../../services/upload-tracker.service';
import { BatchesClientService } from '../../../../services/web/batches-client.service';
import { UploadStatusPreviewComponent } from '../upload-status-preview/upload-status-preview.component';
import { MediaInspectorDialogComponent } from '../../../media-browser/media-inspector-dialog/media-inspector-dialog.component';
import {
  formatMetadataName,
  humanizeBackendLabel,
} from '../../../../utils/media-display.utils';
import {
  applyReviewEntityUpdateToItems,
  refreshRecommendationGroupsForItems,
} from '../../../../utils/review-items.utils';

type ReviewFilter = 'all' | 'missing_character' | 'missing_series' | 'missing_both';
type ReviewView = 'groups' | 'items';
type ReviewScope = 'batch' | 'merged_batch';
const GROUP_PREVIEW_LIMIT = 4;

export interface UploadReviewDialogData {
  batchId: string | null;
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
  private hasAutoSelectedGroupsView = false;

  readonly scope = signal<ReviewScope>(this.data.batchId ? 'batch' : 'merged_batch');
  readonly activeBatchId = signal<string | null>(this.data.batchId);
  readonly filter = signal<ReviewFilter>('all');
  readonly view = signal<ReviewView>('items');
  readonly selectedIds = signal<string[]>([]);
  readonly saving = signal(false);
  readonly characterInputControl = new FormControl('', { nonNullable: true });
  readonly seriesInputControl = new FormControl('', { nonNullable: true });
  readonly characterNames = signal<string[]>([]);
  readonly seriesNames = signal<string[]>([]);
  readonly characterSuggestions = signal<CharacterSuggestion[]>([]);
  readonly seriesSuggestions = signal<SeriesSuggestion[]>([]);
  readonly remoteItems = signal<ImportBatchReviewItemRead[]>([]);
  readonly remoteRecommendationGroups = signal<ImportBatchRecommendationGroupRead[]>([]);
  readonly removedGroupMediaIds = signal<Record<string, string[]>>({});
  readonly discardedMediaIds = signal<string[]>([]);
  readonly expandedGroupIds = signal<string[]>([]);
  readonly remoteRefreshing = signal(false);
  readonly remoteRecommendationsRefreshing = signal(false);
  readonly remoteBaselineTotal = signal(0);

  readonly canMergeAllBatches = computed(() => this.scope() === 'batch' && this.data.batchId !== null);
  readonly reviewState = computed(() =>
    this.scope() === 'batch' && this.data.batchId && this.activeBatchId() === this.data.batchId
      ? this.tracker.getBatchReview(this.data.batchId)
      : null,
  );
  private readonly rawItems = computed(() => this.reviewState()?.reviewItems ?? this.remoteItems());
  private readonly rawRecommendationGroups = computed(() =>
    this.reviewState()?.recommendationGroups ?? this.remoteRecommendationGroups(),
  );
  readonly items = computed(() => this.rawItems());
  readonly recommendationsRefreshing = computed(() =>
    this.reviewState()?.recommendationsRefreshing ?? this.remoteRecommendationsRefreshing(),
  );
  readonly recommendationGroups = computed(() => {
    const itemByMediaId = new Map(this.items().map((item) => [item.media.id, item]));
    const activeReviewIds = new Set(itemByMediaId.keys());

    return this.rawRecommendationGroups()
      .map((group) => {
        const removedIds = new Set([
          ...(this.removedGroupMediaIds()[group.id] ?? []),
          ...this.discardedMediaIds(),
        ]);
        const mediaIds = group.media_ids.filter((id) => !removedIds.has(id) && activeReviewIds.has(id));
        return {
          ...group,
          media_ids: mediaIds,
          item_count: mediaIds.length,
          missing_character_count: mediaIds.filter((mediaId) => {
            const item = itemByMediaId.get(mediaId);
            return !!item?.missing_character;
          }).length,
          missing_series_count: mediaIds.filter((mediaId) => {
            const item = itemByMediaId.get(mediaId);
            return !!item?.missing_series;
          }).length,
        };
      })
      .filter((group) => group.media_ids.length >= 2);
  });
  readonly baselineTotal = computed(() => this.reviewState()?.reviewBaselineTotal ?? this.remoteBaselineTotal());
  readonly reviewedCount = computed(() => Math.max(this.baselineTotal() - this.items().length, 0));
  readonly visibleItems = computed(() => {
    const discardedIds = new Set(this.discardedMediaIds());
    switch (this.filter()) {
      case 'missing_character':
        return this.items().filter((item) => !discardedIds.has(item.media.id) && item.missing_character && !item.missing_series);
      case 'missing_series':
        return this.items().filter((item) => !discardedIds.has(item.media.id) && !item.missing_character && item.missing_series);
      case 'missing_both':
        return this.items().filter((item) => !discardedIds.has(item.media.id) && item.missing_character && item.missing_series);
      default:
        return this.items().filter((item) => !discardedIds.has(item.media.id));
    }
  });
  readonly hasRecommendationGroups = computed(() => this.recommendationGroups().length > 0);
  readonly groupedMediaIds = computed(() =>
    new Set(this.recommendationGroups().flatMap((group) => group.media_ids)),
  );
  readonly ungroupedVisibleItems = computed(() =>
    this.visibleItems().filter((item) => !this.groupedMediaIds().has(item.media.id)),
  );
  readonly visibleRecommendationGroups = computed(() =>
    this.recommendationGroups().filter((group) => this.groupMatchesFilter(group)),
  );
  readonly selectedCount = computed(() => {
    const visibleIds = new Set(this.visibleItems().map((item) => item.media.id));
    return this.selectedIds().filter((id) => visibleIds.has(id)).length;
  });
  readonly reprocessCount = computed(() => this.selectedCount() > 0 ? this.selectedCount() : this.visibleItems().length);
  readonly canApply = computed(() =>
    !this.saving()
    && this.selectedIds().length > 0
    && (this.characterNames().length > 0 || this.seriesNames().length > 0),
  );
  readonly discarding = signal(false);
  readonly mergingAllBatches = signal(false);
  readonly reprocessing = signal(false);

  constructor() {
    effect(() => {
      if (this.hasRecommendationGroups()) {
        if (!this.hasAutoSelectedGroupsView) {
          this.view.set('groups');
          this.hasAutoSelectedGroupsView = true;
        }
      } else {
        if (this.view() !== 'items') {
          this.view.set('items');
        }
        this.hasAutoSelectedGroupsView = false;
      }
    });

    effect(() => {
      const currentIds = new Set(this.items().map((item) => item.media.id));
      const nextSelection = this.selectedIds().filter((id) => currentIds.has(id));
      if (nextSelection.length !== this.selectedIds().length) {
        this.selectedIds.set(nextSelection);
      }
    });

    effect(() => {
      const groupIds = new Set(this.recommendationGroups().map((group) => group.id));
      const nextExpanded = this.expandedGroupIds().filter((groupId) => groupIds.has(groupId));
      if (nextExpanded.length !== this.expandedGroupIds().length) {
        this.expandedGroupIds.set(nextExpanded);
      }
    });

    this.characterInputControl.valueChanges.pipe(
      debounceTime(150),
      distinctUntilChanged(),
      switchMap((value) => {
        const query = value.trim();
        return query ? this.mediaService.getCharacterSuggestions(query, 8, 'owner') : of([]);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((items) => this.characterSuggestions.set(items));

    this.seriesInputControl.valueChanges.pipe(
      debounceTime(150),
      distinctUntilChanged(),
      switchMap((value) => {
        const query = value.trim();
        return query ? this.mediaService.getSeriesSuggestions(query, 8, 'owner') : of([]);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((items) => this.seriesSuggestions.set(items));

    if (this.scope() === 'merged_batch') {
      this.loadMergedReview({
        includeRecommendations: false,
        forceRefresh: false,
        showReviewRefreshing: true,
        refreshRecommendationsAfterLoad: true,
      });
      return;
    }

    this.refreshReview();
    this.refreshRecommendations();
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

  isGroupSelected(group: ImportBatchRecommendationGroupRead): boolean {
    const selectedIds = new Set(this.selectedIds());
    return group.media_ids.length > 0 && group.media_ids.every((id) => selectedIds.has(id));
  }

  selectAllVisible(): void {
    const visibleIds = this.visibleItems().map((item) => item.media.id);
    this.selectedIds.update((ids) => Array.from(new Set([...ids, ...visibleIds])));
  }

  toggleGroupSelection(group: ImportBatchRecommendationGroupRead): void {
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      const allSelected = group.media_ids.every((id) => next.has(id));
      if (allSelected) {
        group.media_ids.forEach((id) => next.delete(id));
      } else {
        group.media_ids.forEach((id) => next.add(id));
      }
      return Array.from(next);
    });
  }

  discardItem(item: ImportBatchReviewItemRead): void {
    this.discardReviewItems([item.media.id], 'Image discarded from missing-name review.');
  }

  discardGroup(group: ImportBatchRecommendationGroupRead): void {
    this.expandedGroupIds.update((ids) => ids.filter((id) => id !== group.id));
    this.discardReviewItems(group.media_ids, 'Group discarded from missing-name review.');
  }

  treatGroupAsSoloPictures(group: ImportBatchRecommendationGroupRead): void {
    if (group.media_ids.length === 0) {
      return;
    }

    this.expandedGroupIds.update((ids) => ids.filter((id) => id !== group.id));
    this.removeMediaFromRecommendationGroups(group.media_ids);
    this.snackBar.open(
      `Group moved to solo picture review for ${group.item_count} item${group.item_count === 1 ? '' : 's'}.`,
      'Close',
      { duration: 3000 },
    );
  }

  removeItemFromGroup(mediaId: string): void {
    const item = this.items().find((entry) => entry.media.id === mediaId);
    if (!item) {
      return;
    }
    this.removeMediaFromRecommendationGroups([mediaId]);
    this.snackBar.open('Image moved to solo picture review.', 'Close', { duration: 3000 });
  }

  clearSelection(): void {
    this.selectedIds.set([]);
  }

  mergeAllBatchesAndRegroup(): void {
    if (!this.canMergeAllBatches() || this.mergingAllBatches()) {
      return;
    }

    this.loadMergedReview({
      includeRecommendations: false,
      forceRefresh: true,
      showReviewRefreshing: true,
      refreshRecommendationsAfterLoad: true,
    });
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

  useCharacterSuggestion(name: string): void {
    this.commitName(this.characterNames, name);
  }

  useSeriesSuggestion(name: string): void {
    this.commitName(this.seriesNames, name);
  }

  applySelected(): void {
    if (!this.canApply()) {
      return;
    }

    const appliedMediaIds = this.selectedIds();
    const characterNames = this.characterNames().map((name) => name.trim()).filter((name) => !!name);
    const seriesNames = this.seriesNames().map((name) => name.trim()).filter((name) => !!name);
    this.saving.set(true);
    this.mediaService.batchUpdateEntities({
      media_ids: appliedMediaIds,
      character_names: characterNames.length > 0 ? characterNames : undefined,
      series_names: seriesNames.length > 0 ? seriesNames : undefined,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.applyReviewEntityUpdate(appliedMediaIds, characterNames, seriesNames);
        this.selectedIds.set([]);
        this.characterNames.set([]);
        this.seriesNames.set([]);
        this.saving.set(false);
        this.snackBar.open('Names applied to selected media.', 'Close', { duration: 3000 });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Could not apply names to selected media.', 'Close', { duration: 4000 });
      },
    });
  }

  reprocessUnresolved(): void {
    if (this.reprocessing()) {
      return;
    }

    const visibleById = new Map(this.visibleItems().map((item) => [item.media.id, item]));
    const targetItems = this.selectedCount() > 0
      ? this.selectedIds()
          .map((id) => visibleById.get(id))
          .filter((item): item is ImportBatchReviewItemRead => !!item)
      : this.visibleItems();
    if (targetItems.length === 0) {
      return;
    }

    const mediaIds = targetItems.map((item) => item.media.id);
    this.reprocessing.set(true);
    this.mediaService.batchQueueTaggingJobs(mediaIds)
      .pipe(
        finalize(() => this.reprocessing.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          this.tracker.registerRetagging(targetItems.map((item) => item.media));
          this.clearSelection();
          this.refreshCurrentScope();
          this.snackBar.open(
            `Queued tagging for ${result.queued} item${result.queued === 1 ? '' : 's'}.`,
            'Close',
            { duration: 4000 },
          );
        },
        error: () => {
          this.snackBar.open('Could not queue tagging for unresolved media.', 'Close', { duration: 4000 });
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

  displaySharedSignal(signal: { kind: string; label: string }): string {
    const kind = humanizeBackendLabel(signal.kind).toLowerCase();
    if (signal.kind === 'tag' || signal.kind === 'entity') {
      return `${kind}: ${formatMetadataName(signal.label)}`;
    }
    return `${kind}: ${signal.label}`;
  }

  displayMetadataName(value: string): string {
    return formatMetadataName(value);
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

  previewItemsForGroup(group: ImportBatchRecommendationGroupRead): ImportBatchReviewItemRead[] {
    const ids = new Set(group.media_ids);
    return this.items().filter((item) => ids.has(item.media.id)).slice(0, GROUP_PREVIEW_LIMIT);
  }

  displayedPreviewItemsForGroup(group: ImportBatchRecommendationGroupRead): ImportBatchReviewItemRead[] {
    const ids = new Set(group.media_ids);
    const items = this.items().filter((item) => ids.has(item.media.id));
    return this.isGroupExpanded(group) ? items : items.slice(0, GROUP_PREVIEW_LIMIT);
  }

  isGroupExpanded(group: ImportBatchRecommendationGroupRead): boolean {
    return this.expandedGroupIds().includes(group.id);
  }

  toggleGroupExpanded(group: ImportBatchRecommendationGroupRead): void {
    if (group.item_count <= GROUP_PREVIEW_LIMIT) {
      return;
    }
    this.expandedGroupIds.update((ids) =>
      ids.includes(group.id) ? ids.filter((id) => id !== group.id) : [...ids, group.id],
    );
  }

  hiddenPreviewCount(group: ImportBatchRecommendationGroupRead): number {
    return Math.max(group.item_count - this.displayedPreviewItemsForGroup(group).length, 0);
  }

  private refreshReview(): void {
    if (this.scope() === 'merged_batch') {
      const batchId = this.activeBatchId();
      if (!batchId) {
        this.loadMergedReview({
          includeRecommendations: false,
          forceRefresh: false,
          showReviewRefreshing: true,
          refreshRecommendationsAfterLoad: false,
        });
        return;
      }

      this.remoteRefreshing.set(true);
      this.batchesClient.listReviewItems(batchId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (response) => {
          this.remoteItems.set(response.items);
          this.removedGroupMediaIds.set({});
          this.discardedMediaIds.set([]);
          this.remoteBaselineTotal.update((current) => Math.max(current, response.total));
          this.remoteRefreshing.set(false);
        },
        error: () => {
          this.remoteRefreshing.set(false);
        },
      });
      return;
    }

    const batchId = this.activeBatchId();
    if (!batchId) {
      return;
    }
    if (this.reviewState()) {
      this.tracker.refreshBatchReview(batchId);
      return;
    }

    this.remoteRefreshing.set(true);
    this.batchesClient.listReviewItems(batchId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.remoteItems.set(response.items);
        this.removedGroupMediaIds.set({});
        this.discardedMediaIds.set([]);
        this.remoteBaselineTotal.update((current) => Math.max(current, response.total));
        this.remoteRefreshing.set(false);
      },
      error: () => {
        this.remoteRefreshing.set(false);
      },
    });
  }

  refreshRecommendations(forceRefresh = false): void {
    if (this.scope() === 'merged_batch') {
      const batchId = this.activeBatchId();
      if (!batchId) {
        this.loadMergedReview({
          includeRecommendations: false,
          forceRefresh: false,
          showReviewRefreshing: false,
          refreshRecommendationsAfterLoad: true,
        });
        return;
      }

      this.remoteRecommendationsRefreshing.set(true);
      this.batchesClient.listReviewItems(batchId, { include_recommendations: true, force_refresh: false })
        .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (response) => {
            this.remoteItems.set(response.items);
            this.remoteRecommendationGroups.set(response.recommendation_groups);
            this.remoteBaselineTotal.update((current) => Math.max(current, response.total));
            this.remoteRecommendationsRefreshing.set(false);
          },
          error: () => {
            this.remoteRecommendationsRefreshing.set(false);
          },
        });
      return;
    }

    const batchId = this.activeBatchId();
    if (!batchId) {
      return;
    }
    if (this.reviewState()) {
      this.tracker.refreshBatchRecommendations(batchId, forceRefresh);
      return;
    }

    this.remoteRecommendationsRefreshing.set(true);
    this.batchesClient.listReviewItems(batchId, { include_recommendations: true, force_refresh: forceRefresh })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (response) => {
          this.remoteItems.set(response.items);
          this.remoteRecommendationGroups.set(response.recommendation_groups);
          this.remoteBaselineTotal.update((current) => Math.max(current, response.total));
          this.remoteRecommendationsRefreshing.set(false);
        },
        error: () => {
          this.remoteRecommendationsRefreshing.set(false);
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

  private groupMatchesFilter(group: ImportBatchRecommendationGroupRead): boolean {
    switch (this.filter()) {
      case 'missing_character':
        return group.media_ids.some((mediaId) => {
          const item = this.items().find((entry) => entry.media.id === mediaId);
          return !!item?.missing_character && !item?.missing_series;
        });
      case 'missing_series':
        return group.media_ids.some((mediaId) => {
          const item = this.items().find((entry) => entry.media.id === mediaId);
          return !item?.missing_character && !!item?.missing_series;
        });
      case 'missing_both':
        return group.media_ids.some((mediaId) => {
          const item = this.items().find((entry) => entry.media.id === mediaId);
          return !!item?.missing_character && !!item?.missing_series;
        });
      default:
        return true;
    }
  }

  private removeMediaFromRecommendationGroups(mediaIds: string[]): void {
    if (mediaIds.length === 0) {
      return;
    }

    const removedIds = new Set(mediaIds);
    this.removedGroupMediaIds.update((current) => {
      const next = { ...current };
      for (const group of this.recommendationGroups()) {
        const intersectingIds = group.media_ids.filter((id) => removedIds.has(id));
        if (intersectingIds.length === 0) {
          continue;
        }
        next[group.id] = Array.from(new Set([...(next[group.id] ?? []), ...intersectingIds]));
      }
      return next;
    });
  }

  private applyReviewEntityUpdate(mediaIds: string[], characterNames: string[], seriesNames: string[]): void {
    if (mediaIds.length === 0) {
      return;
    }

    const resolvedIds = new Set(mediaIds);
    this.selectedIds.update((ids) => ids.filter((id) => !resolvedIds.has(id)));
    this.discardedMediaIds.update((ids) => ids.filter((id) => !resolvedIds.has(id)));
    const remoteResult = applyReviewEntityUpdateToItems(this.remoteItems(), {
      mediaIds,
      characterNames,
      seriesNames,
    });
    this.remoteItems.set(remoteResult.items);
    this.remoteRecommendationGroups.set(
      refreshRecommendationGroupsForItems(this.remoteRecommendationGroups(), remoteResult.items),
    );

    const batchId = this.activeBatchId();
    if (this.scope() === 'batch' && batchId) {
      this.tracker.applyReviewEntityUpdate(batchId, { mediaIds, characterNames, seriesNames });
    }
  }

  private discardReviewItems(mediaIds: string[], successMessage: string): void {
    if (mediaIds.length === 0 || this.discarding()) {
      return;
    }

    this.discarding.set(true);
    this.discardedMediaIds.update((current) => Array.from(new Set([...current, ...mediaIds])));
    this.selectedIds.update((ids) => ids.filter((id) => !mediaIds.includes(id)));

    this.mediaService.batchDismissMetadataReview(mediaIds, true)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.discarding.set(false);
          this.refreshCurrentScope();
          this.snackBar.open(successMessage, 'Close', { duration: 3000 });
        },
        error: () => {
          this.discardedMediaIds.update((current) => current.filter((id) => !mediaIds.includes(id)));
          this.discarding.set(false);
          this.snackBar.open('Could not discard those items from review.', 'Close', { duration: 4000 });
        },
      });
  }

  private refreshCurrentScope(): void {
    if (this.scope() === 'merged_batch') {
      this.refreshRecommendations();
      return;
    }

    this.refreshReview();
  }

  private loadMergedReview(options: {
    includeRecommendations: boolean;
    forceRefresh: boolean;
    showReviewRefreshing: boolean;
    refreshRecommendationsAfterLoad: boolean;
  }): void {
    if (this.remoteRefreshing() || this.remoteRecommendationsRefreshing()) {
      return;
    }

    this.mergingAllBatches.set(true);
    this.remoteRefreshing.set(options.showReviewRefreshing);
    this.remoteRecommendationsRefreshing.set(options.includeRecommendations);
    this.batchesClient.mergeReviewItems({
      include_recommendations: options.includeRecommendations,
      force_refresh: options.forceRefresh,
    })
      .pipe(
        finalize(() => this.mergingAllBatches.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => {
          this.scope.set('merged_batch');
          this.activeBatchId.set(response.merged_batch_id);
          this.resetTransientReviewState({ resetBaseline: true });
          this.remoteItems.set(response.items);
          this.remoteRecommendationGroups.set(response.recommendation_groups);
          this.remoteBaselineTotal.set(response.total);
          this.remoteRefreshing.set(false);
          this.remoteRecommendationsRefreshing.set(false);

          if (
            options.refreshRecommendationsAfterLoad
            && response.total > 1
            && response.recommendation_groups.length === 0
          ) {
            this.refreshRecommendations();
          }
        },
        error: () => {
          this.remoteRefreshing.set(false);
          this.remoteRecommendationsRefreshing.set(false);
          this.snackBar.open('Could not merge unresolved review batches.', 'Close', { duration: 4000 });
        },
      });
  }

  private resetTransientReviewState(options: { resetBaseline: boolean }): void {
    this.selectedIds.set([]);
    this.removedGroupMediaIds.set({});
    this.discardedMediaIds.set([]);
    this.expandedGroupIds.set([]);
    if (options.resetBaseline) {
      this.remoteBaselineTotal.set(0);
    }
  }
}

function normalizeChipValue(rawValue: string): string {
  return rawValue.trim().replace(/\s+/g, ' ');
}
