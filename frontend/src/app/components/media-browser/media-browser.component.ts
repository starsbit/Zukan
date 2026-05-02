import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  NgZone,
  QueryList,
  ViewChild,
  ViewChildren,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, catchError } from 'rxjs';
import { GalleryTimelineMonth, GalleryTimelineYear } from '../../models/gallery-browser';
import { MediaRead, MediaVisibility } from '../../models/media';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { AlbumStore } from '../../services/album.store';
import { GalleryStore } from '../../services/gallery.store';
import { UploadTrackerService } from '../../services/upload-tracker.service';
import { TimelineBucket } from '../../models/timeline';
import { DayGroup } from '../../utils/gallery-grouping.utils';
import { MediaCardComponent } from './media-card/media-card.component';
import { MediaTimelineComponent } from './media-timeline/media-timeline.component';
import { TodayStoriesRailComponent } from '../today-stories/today-stories-rail.component';
import { MatCard, MatCardContent, MatCardHeader, MatCardTitle } from '@angular/material/card';
import {
  AlbumPickerDialogComponent,
  AlbumPickerDialogValue,
} from '../album/album-picker-dialog/album-picker-dialog.component';
import { MediaInspectorDialogComponent } from './media-inspector-dialog/media-inspector-dialog.component';
import { MediaSearchParams } from '../../services/web/media-client.service';
import { MediaService } from '../../services/media.service';
import { NavbarSearchService } from '../../services/navbar-search.service';

interface JustifiedRowItem {
  media: MediaRead | null;
  width: number;
  height: number;
}

interface JustifiedRow {
  items: JustifiedRowItem[];
  height: number;
}

interface JustifiedDayGroup {
  date: string;
  label: string;
  itemCount: number;
  rows: JustifiedRow[];
  isSkeleton: boolean;
}

interface JustifiedMonthGroup {
  year: number;
  month: number;
  label: string;
  days: JustifiedDayGroup[];
}

interface MonthMetric {
  key: string;
  year: number;
  month: number;
  offset: number;
  height: number;
}

const DESKTOP_GRID_GAP = 16;
const MOBILE_GRID_GAP = 12;
const MIN_ROW_HEIGHT = 120;
const MIN_ROW_HEIGHT_COMPACT = 132;
const MAX_ROW_HEIGHT = 320;
const MAX_ROW_HEIGHT_COMPACT = 260;
const DEFAULT_ROW_HEIGHT = 240;
const COMPACT_ROW_HEIGHT = 168;
const WIDTH_FALLBACK = 1200;
const SKELETON_ASPECT_RATIO = 4 / 3;

@Component({
  selector: 'zukan-media-browser',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatToolbarModule,
    MatTooltipModule,
    MediaCardComponent,
    MediaTimelineComponent,
    TodayStoriesRailComponent,
    MatCardContent,
    MatCard,
    MatCardTitle,
    MatCardHeader,
  ],
  templateUrl: './media-browser.component.html',
  styleUrl: './media-browser.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaBrowserComponent {
  readonly mediaVisibility = MediaVisibility;
  readonly dayGroups = input<DayGroup[]>([]);
  readonly timeline = input<TimelineBucket[]>([]);
  readonly loading = input(false);
  readonly showTimeline = input(true);
  readonly allowSelection = input(true);
  readonly selectionActionMode = input<'default' | 'trash'>('default');
  readonly emptyStateTitle = input('No media yet');
  readonly emptyStateMessage = input('Media you have access to will appear here.');
  readonly showPublicBadge = input(true);
  readonly showStories = input(false);
  readonly storyParams = input<MediaSearchParams | null>(null);

  readonly mediaSelected = output<MediaRead>();
  readonly restoreSelected = output<string[]>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly albumStore = inject(AlbumStore);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly dialog = inject(MatDialog);
  private readonly galleryStore = inject(GalleryStore);
  private readonly uploadTracker = inject(UploadTrackerService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly zone = inject(NgZone);
  private readonly mediaService = inject(MediaService);
  private readonly searchService = inject(NavbarSearchService);
  private inspectorRef: MatDialogRef<MediaInspectorDialogComponent> | null = null;

  @ViewChildren('monthSection', { read: ElementRef })
  private readonly monthSections?: QueryList<ElementRef<HTMLElement>>;

  @ViewChild('contentPane', { read: ElementRef })
  private readonly contentPane?: ElementRef<HTMLElement>;

  readonly activeYear = signal<number | null>(null);
  readonly activeMonthKey = signal<string | null>(null);
  readonly activeTimelineProgress = signal<number | null>(null);
  readonly contentWidth = signal(WIDTH_FALLBACK);
  readonly monthMetrics = signal<MonthMetric[]>([]);
  readonly maxScrollTop = signal(0);
  readonly hoveredDay = signal<string | null>(null);
  readonly selectedIds = signal<string[]>([]);
  readonly isCompactLayout = computed(() => this.contentWidth() < 1024);
  readonly isEmpty = computed(
    () => !this.loading() && this.dayGroups().length === 0 && this.timeline().length === 0,
  );
  readonly justifiedMonthGroups = computed(() => this.buildJustifiedMonthGroups());
  readonly timelineEntries = computed(() => this.buildTimelineEntries());
  readonly allMediaIds = computed(() =>
    this.dayGroups().flatMap((group) => group.items.map((item) => item.id)),
  );
  readonly selectedIdSet = computed(() => new Set(this.selectedIds()));
  readonly selectionCount = computed(() => this.selectedIds().length);
  readonly isSelectionMode = computed(() => this.selectionCount() > 0);
  readonly isAllSelected = computed(() => {
    const allIds = this.allMediaIds();
    return allIds.length > 0 && allIds.every((id) => this.selectedIdSet().has(id));
  });

  private resizeObserver?: ResizeObserver;
  private resizeDebounceTimer?: ReturnType<typeof setTimeout>;
  private removeContentScrollListener?: () => void;
  private metricsFrameId: number | null = null;
  private frameId: number | null = null;
  private pendingJumpTargetKey: string | null = null;
  private pendingInspectId: string | null = null;
  private pendingInspectLookupId: string | null = null;
  private currentInspectId: string | null = null;
  private closingInspectorFromRoute = false;
  private closingInspectorFromMetadataFilter = false;

  private static readonly MONTH_FORMAT = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  constructor() {
    effect(() => {
      if (!this.allowSelection() && this.selectedIds().length > 0) {
        this.selectedIds.set([]);
      }
    });

    effect(() => {
      const dayGroups = this.dayGroups();
      untracked(() => {
        this.reconcileSelection(dayGroups);
      });
    });

    effect(() => {
      this.dayGroups();
      this.timeline();
      this.loading();
      untracked(() => {
        this.tryResolvePendingJump();
        this.tryOpenPendingInspector();
        this.scheduleLayoutSync();
      });
    });

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const inspectId = params.get('inspect');
        this.currentInspectId = inspectId;
        if (inspectId) {
          this.openInspectorForId(inspectId);
        } else {
          this.pendingInspectId = null;
          this.pendingInspectLookupId = null;
          if (this.inspectorRef) {
            this.closingInspectorFromRoute = true;
            this.inspectorRef.close();
          }
        }
      });
  }

  ngAfterViewInit(): void {
    this.observeContentWidth();
    this.watchContentScroll();
    this.watchMonthSections();
    this.scheduleLayoutSync();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.removeContentScrollListener?.();
    clearTimeout(this.resizeDebounceTimer);
    if (this.metricsFrameId != null) {
      cancelAnimationFrame(this.metricsFrameId);
    }
    if (this.frameId != null) {
      cancelAnimationFrame(this.frameId);
    }
  }

  sectionId(date: string): string {
    return `gallery-day-${date}`;
  }

  monthSectionId(year: number, month: number): string {
    return `gallery-month-${this.monthKey(year, month)}`;
  }

  monthKey(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  onMediaActivated(media: MediaRead): void {
    this.mediaSelected.emit(media);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { inspect: media.id },
      queryParamsHandling: 'merge',
    });
  }

  private openInspectorForId(id: string): void {
    if (this.inspectorRef) {
      return;
    }
    const items = this.dayGroups().flatMap((group) => group.items);
    if (items.length === 0) {
      this.pendingInspectId = id;
      return;
    }

    if (!items.some((item) => item.id === id)) {
      this.pendingInspectId = id;
      if (this.loading() || this.galleryStore.hasMore()) {
        return;
      }
      this.fetchInspectItem(id, items);
      return;
    }

    this.pendingInspectId = null;
    this.openInspector(items, id);
  }

  private openInspector(items: MediaRead[], activeMediaId: string): void {
    this.inspectorRef = this.dialog.open(MediaInspectorDialogComponent, {
      data: { items, activeMediaId },
      width: '100vw',
      maxWidth: '100vw',
      height: '100vh',
      maxHeight: '100vh',
      autoFocus: false,
      panelClass: 'media-inspector-dialog-panel',
    });
    this.inspectorRef.componentInstance?.activeMediaChanged.subscribe((mediaId) => {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { inspect: mediaId },
        queryParamsHandling: 'merge',
      });
    });
    this.inspectorRef.componentInstance?.metadataFilterSelected.subscribe((selection) => {
      this.closingInspectorFromMetadataFilter = true;
      this.searchService.suppressNextUrlSync();
      this.searchService.addMetadataFilter(selection.type, selection.value);
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          ...this.searchService.toQueryParamsWithClears(),
          inspect: null,
        },
        queryParamsHandling: 'merge',
      });
      this.inspectorRef?.close();
    });
    this.inspectorRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.inspectorRef = null;
      if (this.closingInspectorFromRoute || this.closingInspectorFromMetadataFilter) {
        this.closingInspectorFromRoute = false;
        this.closingInspectorFromMetadataFilter = false;
        return;
      }

      if (!this.currentInspectId) {
        return;
      }

      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { inspect: null },
        queryParamsHandling: 'merge',
      });
    });
  }

  private fetchInspectItem(id: string, currentItems: MediaRead[]): void {
    if (this.pendingInspectLookupId === id) {
      return;
    }

    this.pendingInspectLookupId = id;
    this.mediaService.get(id).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError(() => {
        if (this.pendingInspectId === id) {
          this.pendingInspectId = null;
        }
        this.pendingInspectLookupId = null;
        return EMPTY;
      }),
    ).subscribe((detail) => {
      this.pendingInspectLookupId = null;
      if (this.currentInspectId !== id || this.inspectorRef) {
        return;
      }

      this.pendingInspectId = null;
      const latestItems = this.dayGroups().flatMap((group) => group.items);
      const items = latestItems.some((item) => item.id === id)
        ? latestItems
        : [detail, ...currentItems.filter((item) => item.id !== id)];
      this.openInspector(items, id);
    });
  }

  private tryOpenPendingInspector(): void {
    if (!this.pendingInspectId || this.inspectorRef) {
      return;
    }

    const items = this.dayGroups().flatMap((group) => group.items);
    if (items.length === 0) {
      return;
    }

    this.openInspectorForId(this.pendingInspectId);
  }

  onFavoriteToggled(media: MediaRead): void {
    this.galleryStore.toggleFavorite(media).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  onMediaSelectionToggled(media: MediaRead): void {
    if (!this.allowSelection()) {
      return;
    }
    this.toggleSelection(media.id);
  }

  onDayHover(date: string | null): void {
    this.hoveredDay.set(date);
  }

  toggleDaySelection(group: JustifiedDayGroup, event?: Event): void {
    if (!this.allowSelection()) {
      return;
    }
    event?.stopPropagation();
    const groupIds = group.rows
      .flatMap((row) => row.items.map((item) => item.media?.id))
      .filter((id): id is string => id !== undefined);
    const set = new Set(this.selectedIds());
    const allSelected = groupIds.every((id) => set.has(id));

    if (allSelected) {
      groupIds.forEach((id) => set.delete(id));
    } else {
      groupIds.forEach((id) => set.add(id));
    }

    this.selectedIds.set(Array.from(set));
  }

  onDaySelectionClick(event: Event): void {
    event.stopPropagation();
  }

  clearSelection(): void {
    this.selectedIds.set([]);
  }

  async trashSelection(): Promise<void> {
    const ids = this.selectedIds();
    if (ids.length === 0) {
      return;
    }

    this.confirmDialog
      .open({
        title: 'Move selected media to trash?',
        message: `Move ${ids.length} selected item${ids.length === 1 ? '' : 's'} to the trash?`,
        confirmLabel: 'Move to trash',
        tone: 'warn',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) {
          return;
        }

        this.galleryStore
          .batchDelete(ids)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(() => {
            this.clearSelection();
            this.snackBar.open(
              `Moved ${ids.length} item${ids.length === 1 ? '' : 's'} to trash.`,
              'Close',
              { duration: 4000 },
            );
          });
      });
  }

  requestRestoreSelection(): void {
    const ids = this.selectedIds();
    if (ids.length === 0) {
      return;
    }

    this.restoreSelected.emit(ids);
  }

  reprocessSelection(): void {
    const ids = this.selectedIds();
    if (ids.length === 0) {
      return;
    }

    this.confirmDialog
      .open({
        title: 'Reprocess tagging?',
        message: `Queue tagging again for ${ids.length} selected item${ids.length === 1 ? '' : 's'}?`,
        confirmLabel: 'Reprocess tagging',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) {
          return;
        }

        this.galleryStore
          .batchQueueTaggingJobs(ids)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((result) => {
            this.uploadTracker.registerRetagging(this.selectedMedia());
            this.clearSelection();
            this.snackBar.open(
              `Queued tagging for ${result.queued} item${result.queued === 1 ? '' : 's'}.`,
              'Close',
              { duration: 4000 },
            );
          });
      });
  }

  addSelectionToAlbum(): void {
    const ids = this.selectedIds();
    if (ids.length === 0) {
      return;
    }

    this.dialog
      .open(AlbumPickerDialogComponent, {
        data: {
          title: 'Add to album',
          confirmLabel: 'Add to album',
          selectedCount: ids.length,
        },
        maxWidth: '560px',
        width: '100%',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value: AlbumPickerDialogValue | undefined) => {
        if (!value) {
          return;
        }

        this.albumStore
          .addMedia(value.albumId, ids)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((result) => {
            this.clearSelection();
            this.snackBar.open(
              `Added ${result.processed} item${result.processed === 1 ? '' : 's'} to ${value.albumName}.`,
              'Close',
              { duration: 4000 },
            );
          });
      });
  }

  updateSelectionVisibility(visibility: MediaVisibility): void {
    const ids = this.selectedIds();
    if (ids.length === 0) {
      return;
    }

    const visibilityLabel = visibility === MediaVisibility.PUBLIC ? 'public' : 'private';
    this.confirmDialog
      .open({
        title: `Make selected media ${visibilityLabel}?`,
        message: `Change ${ids.length} selected item${ids.length === 1 ? '' : 's'} to ${visibilityLabel}?`,
        confirmLabel: `Make ${visibilityLabel}`,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) {
          return;
        }

        this.galleryStore
          .batchUpdateVisibility(ids, visibility)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(() => {
            this.clearSelection();
            this.snackBar.open(
              `Updated ${ids.length} item${ids.length === 1 ? '' : 's'} to ${visibilityLabel}.`,
              'Close',
              { duration: 4000 },
            );
          });
      });
  }

  downloadSelection(): void {
    const ids = this.selectedIds();
    if (ids.length === 0) {
      return;
    }

    this.mediaService
      .download(ids)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'media.zip';
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  isDaySelected(group: JustifiedDayGroup): boolean {
    const ids = group.rows
      .flatMap((row) => row.items.map((item) => item.media?.id))
      .filter((id): id is string => id !== undefined);
    return ids.length > 0 && ids.every((id) => this.selectedIdSet().has(id));
  }

  isMediaSelected(id: string): boolean {
    return this.selectedIdSet().has(id);
  }

  onJumpRequested(targetKey: string): void {
    this.pendingJumpTargetKey = targetKey;
    this.tryResolvePendingJump();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const isEditable =
      !!target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    if (isEditable) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      if (!this.allowSelection()) {
        return;
      }
      event.preventDefault();
      this.selectedIds.set(this.allMediaIds());
      return;
    }

    if (event.key === 'Escape' && this.allowSelection() && this.isSelectionMode()) {
      event.preventDefault();
      this.clearSelection();
    }
  }

  private toggleSelection(id: string): void {
    this.selectedIds.update((ids) =>
      ids.includes(id) ? ids.filter((existingId) => existingId !== id) : [...ids, id],
    );
  }

  private selectedMedia(): MediaRead[] {
    const selected = this.selectedIdSet();
    return this.dayGroups()
      .flatMap((group) => group.items)
      .filter((media) => selected.has(media.id));
  }

  private reconcileSelection(dayGroups = this.dayGroups()): void {
    const visibleIds = new Set(
      dayGroups.flatMap((group) => group.items.map((item) => item.id)),
    );
    this.selectedIds.update((ids) => {
      const nextIds = ids.filter((id) => visibleIds.has(id));
      if (nextIds.length === ids.length && nextIds.every((id, index) => id === ids[index])) {
        return ids;
      }

      return nextIds;
    });
  }

  private observeContentWidth(): void {
    const content = this.contentPane?.nativeElement;
    if (!content) {
      return;
    }

    this.syncContentWidth();
    requestAnimationFrame(() => this.syncContentWidth());
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? this.measureContentWidth(content);
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = setTimeout(() => {
        const nextWidth = Math.max(Math.floor(width), 320);
        if (nextWidth === this.contentWidth()) {
          return;
        }
        this.contentWidth.set(nextWidth);
        this.scheduleLayoutSync();
      }, 60);
    });
    this.resizeObserver.observe(content);
  }

  private watchMonthSections(): void {
    if (!this.monthSections) {
      return;
    }

    this.monthSections.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.tryResolvePendingJump();
      this.scheduleLayoutSync();
    });
    this.scheduleLayoutSync();
  }

  private watchContentScroll(): void {
    const content = this.contentPane?.nativeElement;
    if (!content || this.removeContentScrollListener) {
      return;
    }

    this.zone.runOutsideAngular(() => {
      const onScroll = () => {
        this.scheduleActiveSectionSync();
      };
      content.addEventListener('scroll', onScroll, { passive: true });
      this.removeContentScrollListener = () => {
        content.removeEventListener('scroll', onScroll);
        this.removeContentScrollListener = undefined;
      };
    });
  }

  private syncMonthMetrics(): void {
    const content = this.contentPane?.nativeElement;
    const sections = this.monthSections?.toArray() ?? [];
    if (!content || sections.length === 0) {
      if (this.monthMetrics().length > 0) {
        this.monthMetrics.set([]);
      }
      if (this.maxScrollTop() !== 0) {
        this.maxScrollTop.set(0);
      }
      return;
    }

    const metrics: MonthMetric[] = [];
    for (const ref of sections) {
      const el = ref.nativeElement;
      const key = el.dataset['month'];
      if (key) {
        const parts = this.parseMonthKey(key);
        metrics.push({
          key,
          year: parts.year,
          month: parts.month,
          height: el.offsetHeight,
          offset: this.measureMonthSectionOffset(el, content),
        });
      }
    }

    if (!this.areMonthMetricsEqual(this.monthMetrics(), metrics)) {
      this.monthMetrics.set(metrics);
    }

    const nextMaxScrollTop = Math.max(content.scrollHeight - content.clientHeight, 0);
    if (nextMaxScrollTop !== this.maxScrollTop()) {
      this.maxScrollTop.set(nextMaxScrollTop);
    }
  }

  private scheduleActiveSectionSync(): void {
    if (this.frameId != null) {
      return;
    }

    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      this.syncActiveSection();
    });
  }

  private scheduleLayoutSync(): void {
    if (this.metricsFrameId != null) {
      return;
    }

    this.metricsFrameId = requestAnimationFrame(() => {
      this.metricsFrameId = null;
      this.syncMonthMetrics();
      this.syncActiveSection();
    });
  }

  private syncActiveSection(): void {
    const content = this.contentPane?.nativeElement;
    const metrics = this.monthMetrics();
    if (!content || metrics.length === 0) {
      this.activeYear.set(null);
      this.activeMonthKey.set(null);
      this.activeTimelineProgress.set(null);
      return;
    }

    const scrollTop = content.scrollTop;
    const activeMetric = this.findActiveMonthMetric(metrics, scrollTop);
    const maxScrollTop = this.maxScrollTop();
    const scrollProgress =
      maxScrollTop <= 0 ? 0 : this.clamp(scrollTop / maxScrollTop, 0, 1);

    this.activeTimelineProgress.set(scrollProgress * 100);
    this.activeYear.set(activeMetric?.year ?? null);
    this.activeMonthKey.set(activeMetric?.key ?? null);
  }

  private buildTimelineEntries(): GalleryTimelineYear[] {
    const buckets = this.timeline();
    if (buckets.length === 0) {
      return [];
    }

    const metrics = new Map(
      this.monthMetrics().map((metric) => [metric.key, metric] as const),
    );
    const maxScrollTop = this.maxScrollTop();
    const monthGroups = this.justifiedMonthGroups();

    const renderedMonthKeys = new Set(
      monthGroups
        .filter((mg) => mg.days.some((d) => !d.isSkeleton))
        .map((mg) => this.monthKey(mg.year, mg.month)),
    );

    const totalCount = buckets.reduce((sum, b) => sum + b.count, 0);

    let totalHeight = 0;
    const monthHeightList: { key: string; h: number; bucket: TimelineBucket }[] = [];

    for (const bucket of buckets) {
      const key = this.monthKey(bucket.year, bucket.month);
      const measured = metrics.get(key)?.height;
      const estimated = totalCount > 0 ? (bucket.count / totalCount) * 1000 : 1;
      const h = measured ?? estimated;
      monthHeightList.push({ key, h, bucket });
      totalHeight += h;
    }

    const years: GalleryTimelineYear[] = [];
    const yearMap = new Map<number, GalleryTimelineYear>();
    let cumulativeHeight = 0;

    for (const { key, h, bucket } of monthHeightList) {
      let entry = yearMap.get(bucket.year);
      if (!entry) {
        entry = { year: bucket.year, count: 0, months: [] };
        yearMap.set(bucket.year, entry);
        years.push(entry);
      }

      entry.count += bucket.count;
      const offset = metrics.get(key)?.offset;
      const position =
        offset !== undefined && maxScrollTop > 0
          ? this.clamp((Math.min(offset, maxScrollTop) / maxScrollTop) * 100, 0, 100)
          : totalHeight > 0
            ? (cumulativeHeight / totalHeight) * 100
            : 0;
      entry.months.push({
        year: bucket.year,
        month: bucket.month,
        count: bucket.count,
        position,
        rendered: renderedMonthKeys.has(key),
        anchorId: this.monthSectionId(bucket.year, bucket.month),
      });

      cumulativeHeight += h;
    }

    return years;
  }

  private tryResolvePendingJump(): void {
    const targetKey = this.pendingJumpTargetKey;
    if (!targetKey) {
      return;
    }

    const months = this.flattenTimelineMonths();
    const target = months.find((m) => this.monthKey(m.year, m.month) === targetKey);

    if (!target) {
      this.pendingJumpTargetKey = null;
      return;
    }

    if (this.scrollToAnchor(target.anchorId)) {
      this.pendingJumpTargetKey = null;
      return;
    }

    const rendered = months.filter((m) => m.rendered);
    if (rendered.length === 0) {
      this.pendingJumpTargetKey = null;
      return;
    }

    const nearest = rendered.reduce<GalleryTimelineMonth>(
      (best, m) =>
        Math.abs(m.position - target.position) < Math.abs(best.position - target.position)
          ? m
          : best,
      rendered[0]!,
    );

    if (this.scrollToAnchor(nearest.anchorId)) {
      this.pendingJumpTargetKey = null;
    }
  }

  private scrollToAnchor(anchorId: string): boolean {
    const content = this.contentPane?.nativeElement;
    const target = typeof document !== 'undefined' ? document.getElementById(anchorId) : null;
    if (!content || !target) {
      return false;
    }

    const cachedMonthMetric = this.monthMetrics().find(
      (metric) => this.monthSectionId(metric.year, metric.month) === anchorId,
    );
    const nextTop = cachedMonthMetric?.offset ?? this.measureOffsetWithinContent(target, content);
    if (typeof content.scrollTo === 'function') {
      content.scrollTo({ top: Math.max(nextTop, 0), behavior: 'auto' });
    } else {
      content.scrollTop = Math.max(nextTop, 0);
    }
    this.scheduleActiveSectionSync();
    return true;
  }

  private measureOffsetWithinContent(target: HTMLElement, content: HTMLElement): number {
    let offset = 0;
    let node: HTMLElement | null = target;

    while (node && node !== content) {
      offset += node.offsetTop;
      node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
    }

    if (node === content) {
      return offset;
    }

    const contentRect = content.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    return content.scrollTop + (targetRect.top - contentRect.top);
  }

  private measureMonthSectionOffset(target: HTMLElement, content: HTMLElement): number {
    if (target.parentElement === content) {
      return target.offsetTop;
    }

    return this.measureOffsetWithinContent(target, content);
  }

  private flattenTimelineMonths() {
    return this.timelineEntries().flatMap((entry) => entry.months);
  }

  private buildJustifiedMonthGroups(): JustifiedMonthGroup[] {
    const contentWidth = this.contentWidth();
    const rowHeight = this.preferredRowHeight(contentWidth);
    const gap = this.gridGap(contentWidth);

    const realGroupsByMonth = new Map<string, DayGroup[]>();
    for (const group of this.dayGroups()) {
      const key = group.date.slice(0, 7);
      if (!realGroupsByMonth.has(key)) {
        realGroupsByMonth.set(key, []);
      }
      realGroupsByMonth.get(key)!.push(group);
    }

    if (this.timeline().length === 0 && this.dayGroups().length > 0) {
      const monthMap = new Map<string, JustifiedMonthGroup>();
      const result: JustifiedMonthGroup[] = [];
      for (const group of this.dayGroups()) {
        const key = group.date.slice(0, 7);
        const parts = key.split('-').map(Number);
        const year = parts[0]!;
        const month = parts[1]!;
        if (!monthMap.has(key)) {
          const mg: JustifiedMonthGroup = {
            year,
            month,
            label: this.formatMonthLabel(year, month),
            days: [],
          };
          monthMap.set(key, mg);
          result.push(mg);
        }
        monthMap.get(key)!.days.push({
          date: group.date,
          label: group.label,
          itemCount: group.items.length,
          rows: this.justifyRows(group.items, contentWidth, rowHeight, gap),
          isSkeleton: false,
        });
      }
      return result;
    }

    const result: JustifiedMonthGroup[] = [];
    for (const bucket of this.timeline()) {
      const key = this.monthKey(bucket.year, bucket.month);
      const monthGroup: JustifiedMonthGroup = {
        year: bucket.year,
        month: bucket.month,
        label: this.formatMonthLabel(bucket.year, bucket.month),
        days: [],
      };

      if (realGroupsByMonth.has(key)) {
        for (const group of realGroupsByMonth.get(key)!) {
          monthGroup.days.push({
            date: group.date,
            label: group.label,
            itemCount: group.items.length,
            rows: this.justifyRows(group.items, contentWidth, rowHeight, gap),
            isSkeleton: false,
          });
        }
      } else if (this.loading() || this.galleryStore.hasMore()) {
        monthGroup.days.push(this.buildSkeletonGroup(bucket, contentWidth, rowHeight, gap));
      }

      if (monthGroup.days.length > 0) {
        result.push(monthGroup);
      }
    }
    return result;
  }

  private buildSkeletonGroup(
    bucket: TimelineBucket,
    contentWidth: number,
    rowHeight: number,
    gap: number,
  ): JustifiedDayGroup {
    return {
      date: this.monthKey(bucket.year, bucket.month),
      label: this.formatMonthLabel(bucket.year, bucket.month),
      itemCount: bucket.count,
      rows: this.justifySkeletonRows(bucket.count, contentWidth, rowHeight, gap),
      isSkeleton: true,
    };
  }

  private justifySkeletonRows(
    count: number,
    contentWidth: number,
    targetRowHeight: number,
    gap: number,
  ): JustifiedRow[] {
    const rows: JustifiedRow[] = [];
    let remaining = count;
    const minH = contentWidth < 1024 ? MIN_ROW_HEIGHT_COMPACT : MIN_ROW_HEIGHT;
    const maxH = contentWidth < 1024 ? MAX_ROW_HEIGHT_COMPACT : MAX_ROW_HEIGHT;

    while (remaining > 0) {
      const itemsPerRow = Math.max(
        1,
        Math.floor((contentWidth + gap) / (targetRowHeight * SKELETON_ASPECT_RATIO + gap)),
      );
      const batch = Math.min(itemsPerRow, remaining);
      const gapWidth = gap * Math.max(batch - 1, 0);
      const naturalH = (contentWidth - gapWidth) / (batch * SKELETON_ASPECT_RATIO);
      const isFullRow = batch === itemsPerRow && remaining > batch;
      const rowH = isFullRow ? this.clamp(naturalH, minH, maxH) : Math.min(targetRowHeight, maxH);
      const baseW = rowH * SKELETON_ASPECT_RATIO;
      const items: JustifiedRowItem[] = Array.from({ length: batch }, () => ({
        media: null,
        width: baseW,
        height: rowH,
      }));
      if (isFullRow) {
        const totalW = items.reduce((s, item) => s + item.width, 0);
        const scale = (contentWidth - gapWidth) / totalW;
        for (const item of items) {
          item.width *= scale;
        }
      }
      rows.push({ height: rowH, items });
      remaining -= batch;
    }
    return rows;
  }

  private formatMonthLabel(year: number, month: number): string {
    return MediaBrowserComponent.MONTH_FORMAT.format(
      new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00Z`),
    );
  }

  private justifyRows(
    items: MediaRead[],
    contentWidth: number,
    targetRowHeight: number,
    gap: number,
  ): JustifiedRow[] {
    const rows: JustifiedRow[] = [];
    let rowItems: MediaRead[] = [];
    let aspectSum = 0;
    const minRowHeight = contentWidth < 1024 ? MIN_ROW_HEIGHT_COMPACT : MIN_ROW_HEIGHT;
    const maxRowHeight = contentWidth < 1024 ? MAX_ROW_HEIGHT_COMPACT : MAX_ROW_HEIGHT;

    const pushRow = (justify: boolean): void => {
      if (rowItems.length === 0) {
        return;
      }

      const gapWidth = gap * Math.max(rowItems.length - 1, 0);
      const naturalHeight = (contentWidth - gapWidth) / Math.max(aspectSum, 0.1);
      const rowHeight = justify
        ? this.clamp(naturalHeight, minRowHeight, maxRowHeight)
        : Math.min(targetRowHeight, maxRowHeight);

      const widths = rowItems.map((item) => rowHeight * this.aspectRatioFor(item));
      if (justify) {
        const totalWidth = widths.reduce((sum, width) => sum + width, 0);
        const scale = totalWidth > 0 ? (contentWidth - gapWidth) / totalWidth : 1;
        for (let index = 0; index < widths.length; index += 1) {
          widths[index] *= scale;
        }
      }

      rows.push({
        height: rowHeight,
        items: rowItems.map((media, index) => ({
          media,
          width: Math.max(widths[index] ?? rowHeight, 1),
          height: rowHeight,
        })),
      });

      rowItems = [];
      aspectSum = 0;
    };

    for (const item of items) {
      rowItems.push(item);
      aspectSum += this.aspectRatioFor(item);

      const gapWidth = gap * Math.max(rowItems.length - 1, 0);
      const projectedHeight = (contentWidth - gapWidth) / Math.max(aspectSum, 0.1);
      if (projectedHeight <= targetRowHeight) {
        pushRow(true);
      }
    }

    pushRow(false);
    return rows;
  }

  private preferredRowHeight(contentWidth: number): number {
    if (contentWidth < 420) {
      return 152;
    }

    if (contentWidth < 560) {
      return COMPACT_ROW_HEIGHT;
    }

    if (contentWidth < 900) {
      return 210;
    }

    return DEFAULT_ROW_HEIGHT;
  }

  private gridGap(contentWidth: number): number {
    return contentWidth < 1024 ? MOBILE_GRID_GAP : DESKTOP_GRID_GAP;
  }

  private aspectRatioFor(media: MediaRead): number {
    const width = media.metadata.width ?? 1;
    const height = media.metadata.height ?? 1;
    return Math.max(width, 1) / Math.max(height, 1);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private syncContentWidth(): void {
    const content = this.contentPane?.nativeElement;
    if (!content) {
      return;
    }

    this.contentWidth.set(this.measureContentWidth(content));
  }

  onScrollRequested(progress: number): void {
    const content = this.contentPane?.nativeElement;
    if (!content) {
      return;
    }

    content.scrollTop = progress * this.maxScrollTop();
    this.scheduleActiveSectionSync();
  }

  private measureContentWidth(content: HTMLElement): number {
    const measured = Math.max(
      content.clientWidth,
      content.offsetWidth,
      Math.floor(content.getBoundingClientRect().width),
    );

    return Math.max(measured, 320);
  }

  private areMonthMetricsEqual(current: MonthMetric[], next: MonthMetric[]): boolean {
    if (current.length !== next.length) {
      return false;
    }

    return current.every((metric, index) => {
      const candidate = next[index];
      return candidate != null
        && metric.key === candidate.key
        && metric.year === candidate.year
        && metric.month === candidate.month
        && metric.offset === candidate.offset
        && metric.height === candidate.height;
    });
  }

  private findActiveMonthMetric(metrics: MonthMetric[], scrollTop: number): MonthMetric | null {
    let low = 0;
    let high = metrics.length - 1;
    let active = metrics[0] ?? null;
    const target = scrollTop + 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const metric = metrics[mid]!;
      if (metric.offset <= target) {
        active = metric;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return active;
  }

  private parseMonthKey(key: string): { year: number; month: number } {
    const [year, month] = key.split('-').map(Number);
    return {
      year: year || 0,
      month: month || 0,
    };
  }
}
