import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { Observable, debounceTime, distinctUntilChanged, finalize, map } from 'rxjs';
import { MetadataNameListResponse, MetadataNameRead, TagListResponse, TagManagementResult, TagRead } from '../../models/tags';
import { MetadataNameMergeDialogComponent } from '../../components/metadata/metadata-name-merge-dialog/metadata-name-merge-dialog.component';
import { TagMergeDialogComponent } from '../../components/metadata/tag-merge-dialog/tag-merge-dialog.component';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { TagsClientService } from '../../services/web/tags-client.service';
import { formatMetadataName } from '../../utils/media-display.utils';

type SortOption = 'media_count_desc' | 'name_asc' | 'name_desc' | 'media_count_asc';
type MetadataTab = 'tags' | 'characters' | 'series';

@Component({
  selector: 'zukan-metadata-manager-page',
  imports: [
    ReactiveFormsModule,
    LayoutComponent,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTabsModule,
  ],
  templateUrl: './metadata-manager-page.component.html',
  styleUrl: './metadata-manager-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetadataManagerPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly fb = inject(FormBuilder);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly tagsClient = inject(TagsClientService);

  readonly filters = this.fb.nonNullable.group({
    query: [''],
    sort: ['media_count_desc' as SortOption],
  });

  readonly activeTab = signal<MetadataTab>('tags');
  readonly tags = signal<TagRead[]>([]);
  readonly characterNames = signal<MetadataNameRead[]>([]);
  readonly seriesNames = signal<MetadataNameRead[]>([]);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly error = signal<string | null>(null);
  readonly actioningKeys = signal<string[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly hasMore = signal(false);
  readonly resultSummary = signal<string | null>(null);
  readonly total = signal<number | null>(null);

  readonly activeViewLabel = computed(() => {
    switch (this.activeTab()) {
      case 'characters':
        return 'Characters';
      case 'series':
        return 'Series';
      default:
        return 'Tags';
    }
  });
  readonly activeNoun = computed(() => {
    switch (this.activeTab()) {
      case 'characters':
        return 'character name';
      case 'series':
        return 'series name';
      default:
        return 'tag';
    }
  });
  readonly currentTagItems = computed(() => this.tags());
  readonly currentNameItems = computed(() => {
    switch (this.activeTab()) {
      case 'characters':
        return this.characterNames();
      case 'series':
        return this.seriesNames();
      default:
        return [];
    }
  });
  readonly isTagTab = computed(() => this.activeTab() === 'tags');

  constructor() {
    this.filters.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef),
      debounceTime(180),
      map((value) => JSON.stringify(value)),
      distinctUntilChanged(),
    ).subscribe(() => {
      this.reload();
    });

    this.reload();
  }

  protected onTabChange(index: number): void {
    const nextTab: MetadataTab = index === 1 ? 'characters' : index === 2 ? 'series' : 'tags';
    if (nextTab === this.activeTab()) {
      return;
    }
    this.activeTab.set(nextTab);
    this.resultSummary.set(null);
    this.reload();
  }

  protected clearQuery(): void {
    this.filters.controls.query.setValue('');
  }

  protected loadMore(): void {
    if (!this.hasMore() || this.loadingMore() || this.loading()) {
      return;
    }
    this.fetchPage(this.nextCursor(), true);
  }

  protected openTagMergeDialog(tag: TagRead): void {
    if (this.isActioning(this.itemActionKey(tag.id))) {
      return;
    }

    this.dialog.open(TagMergeDialogComponent, {
      data: { sourceTag: tag },
      width: 'min(42rem, 96vw)',
      maxWidth: '96vw',
      autoFocus: false,
    }).afterClosed().subscribe((targetTag: TagRead | null) => {
      if (!targetTag) {
        return;
      }

      const key = this.itemActionKey(tag.id);
      this.setActioning(key, true);
      this.tagsClient.merge(tag.id, targetTag.id).pipe(
        finalize(() => this.setActioning(key, false)),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe({
        next: (result) => {
          const summary = this.buildTagMergeSummary(tag, targetTag, result);
          this.resultSummary.set(summary);
          this.snackBar.open(summary, 'Close', { duration: 5000 });
          this.reload();
        },
        error: (err) => {
          this.snackBar.open(err.error?.detail ?? 'Unable to merge those tags.', 'Close', { duration: 5000 });
        },
      });
    });
  }

  protected openNameMergeDialog(item: MetadataNameRead): void {
    const key = this.itemActionKey(item.name);
    if (this.isActioning(key)) {
      return;
    }

    const kind = this.activeTab();
    if (kind === 'tags') {
      return;
    }

    this.dialog.open(MetadataNameMergeDialogComponent, {
      data: { kind, sourceName: item.name, mediaCount: item.media_count },
      width: 'min(42rem, 96vw)',
      maxWidth: '96vw',
      autoFocus: false,
    }).afterClosed().subscribe((targetItem: MetadataNameRead | null) => {
      if (!targetItem) {
        return;
      }

      this.setActioning(key, true);
      const request = kind === 'characters'
        ? this.tagsClient.mergeCharacterName(item.name, targetItem.name)
        : this.tagsClient.mergeSeriesName(item.name, targetItem.name);
      request.pipe(
        finalize(() => this.setActioning(key, false)),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe({
        next: (result) => {
          const summary = this.buildNameMergeSummary(item.name, targetItem.name, result);
          this.resultSummary.set(summary);
          this.snackBar.open(summary, 'Close', { duration: 5000 });
          this.reload();
        },
        error: (err) => {
          this.snackBar.open(
            err.error?.detail ?? `Unable to merge those ${kind === 'characters' ? 'character names' : 'series names'}.`,
            'Close',
            { duration: 5000 },
          );
        },
      });
    });
  }

  protected removeTagFromMedia(tag: TagRead): void {
    const key = this.itemActionKey(tag.id);
    if (this.isActioning(key)) {
      return;
    }

    this.confirmDialog.open({
      title: 'Remove tag from your media?',
      message: `This will remove "${formatMetadataName(tag.name)}" from matching media in your library. ${tag.media_count} media currently match.`,
      confirmLabel: 'Remove tag',
      cancelLabel: 'Cancel',
      tone: 'warn',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.setActioning(key, true);
      this.tagsClient.removeFromMedia(tag.id).pipe(
        finalize(() => this.setActioning(key, false)),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe({
        next: (result) => {
          const summary = this.buildDeleteSummary(tag.name, result, 'tag');
          this.resultSummary.set(summary);
          this.snackBar.open(summary, 'Close', { duration: 5000 });
          this.reload();
        },
        error: (err) => {
          this.snackBar.open(err.error?.detail ?? 'Unable to remove that tag from media.', 'Close', { duration: 5000 });
        },
      });
    });
  }

  protected removeNameFromMedia(item: MetadataNameRead): void {
    const kind = this.activeTab();
    if (kind === 'tags') {
      return;
    }

    const key = this.itemActionKey(item.name);
    if (this.isActioning(key)) {
      return;
    }

    const noun = kind === 'characters' ? 'character name' : 'series name';
    this.confirmDialog.open({
      title: `Remove ${noun} from your media?`,
      message: `This will remove "${formatMetadataName(item.name)}" from matching media in your library. ${item.media_count} media currently match.`,
      confirmLabel: `Remove ${noun}`,
      cancelLabel: 'Cancel',
      tone: 'warn',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.setActioning(key, true);
      const request = kind === 'characters'
        ? this.tagsClient.removeCharacterFromMedia(item.name)
        : this.tagsClient.removeSeriesFromMedia(item.name);
      request.pipe(
        finalize(() => this.setActioning(key, false)),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe({
        next: (result) => {
          const summary = this.buildDeleteSummary(item.name, result, noun);
          this.resultSummary.set(summary);
          this.snackBar.open(summary, 'Close', { duration: 5000 });
          this.reload();
        },
        error: (err) => {
          this.snackBar.open(
            err.error?.detail ?? `Unable to remove that ${noun} from media.`,
            'Close',
            { duration: 5000 },
          );
        },
      });
    });
  }

  protected isActioning(key: string): boolean {
    return this.actioningKeys().includes(key);
  }

  private reload(): void {
    this.replaceActiveItems([]);
    this.nextCursor.set(null);
    this.hasMore.set(false);
    this.total.set(null);
    this.fetchPage(null, false);
  }

  private fetchPage(after: string | null, append: boolean): void {
    this.error.set(null);
    if (append) {
      this.loadingMore.set(true);
    } else {
      this.loading.set(true);
    }

    const { sort_by, sort_order } = this.resolveSort();
    const request: Observable<TagListResponse | MetadataNameListResponse> = this.activeTab() === 'tags'
      ? this.tagsClient.list({
          after: after ?? undefined,
          page_size: 100,
          q: this.filters.controls.query.value.trim() || undefined,
          sort_by,
          sort_order,
          scope: 'owner',
        })
      : this.activeTab() === 'characters'
        ? this.tagsClient.listCharacterNames({
            after: after ?? undefined,
            page_size: 100,
            q: this.filters.controls.query.value.trim() || undefined,
            sort_by,
            sort_order,
            scope: 'owner',
          })
        : this.tagsClient.listSeriesNames({
            after: after ?? undefined,
            page_size: 100,
            q: this.filters.controls.query.value.trim() || undefined,
            sort_by,
            sort_order,
            scope: 'owner',
          });

    request.pipe(
      finalize(() => {
        this.loading.set(false);
        this.loadingMore.set(false);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (page: TagListResponse | MetadataNameListResponse) => {
        this.replaceActiveItems(page.items, append);
        this.total.set(page.total);
        this.nextCursor.set(page.next_cursor);
        this.hasMore.set(page.has_more);
      },
      error: (err: { error?: { detail?: string } }) => {
        this.error.set(err.error?.detail ?? `Unable to load your ${this.activeViewLabel().toLowerCase()}.`);
      },
    });
  }

  private replaceActiveItems(items: TagRead[] | MetadataNameRead[], append = false): void {
    switch (this.activeTab()) {
      case 'characters':
        this.characterNames.update((current) => append ? [...current, ...(items as MetadataNameRead[])] : items as MetadataNameRead[]);
        break;
      case 'series':
        this.seriesNames.update((current) => append ? [...current, ...(items as MetadataNameRead[])] : items as MetadataNameRead[]);
        break;
      default:
        this.tags.update((current) => append ? [...current, ...(items as TagRead[])] : items as TagRead[]);
        break;
    }
  }

  private resolveSort(): { sort_by: 'name' | 'media_count'; sort_order: 'asc' | 'desc' } {
    switch (this.filters.controls.sort.value) {
      case 'name_asc':
        return { sort_by: 'name', sort_order: 'asc' };
      case 'name_desc':
        return { sort_by: 'name', sort_order: 'desc' };
      case 'media_count_asc':
        return { sort_by: 'media_count', sort_order: 'asc' };
      default:
        return { sort_by: 'media_count', sort_order: 'desc' };
    }
  }

  private itemActionKey(value: number | string): string {
    return `${this.activeTab()}:${String(value)}`;
  }

  private setActioning(key: string, active: boolean): void {
    this.actioningKeys.update((keys) => {
      if (active) {
        return keys.includes(key) ? keys : [...keys, key];
      }
      return keys.filter((item) => item !== key);
    });
  }

  private buildDeleteSummary(name: string, result: TagManagementResult, noun: string): string {
    const cleanup = result.deleted_tag || result.deleted_source ? ` The source ${noun} no longer has any remaining references.` : '';
    return `Removed "${formatMetadataName(name)}" from ${result.updated_media} media.${cleanup}`;
  }

  private buildTagMergeSummary(sourceTag: TagRead, targetTag: TagRead, result: TagManagementResult): string {
    const cleanup = result.deleted_source ? ' The source tag was fully cleaned up.' : '';
    return `Merged "${formatMetadataName(sourceTag.name)}" into "${formatMetadataName(targetTag.name)}" on ${result.updated_media} media.${cleanup}`;
  }

  private buildNameMergeSummary(sourceName: string, targetName: string, result: TagManagementResult): string {
    const cleanup = result.deleted_source ? ` The source ${this.activeNoun()} was fully cleaned up.` : '';
    return `Merged "${formatMetadataName(sourceName)}" into "${formatMetadataName(targetName)}" on ${result.updated_media} media.${cleanup}`;
  }

  protected displayMetadataName(value: string): string {
    return formatMetadataName(value);
  }
}
