import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  NgZone,
  QueryList,
  ViewChild,
  ViewChildren,
  afterEveryRender,
  afterNextRender,
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
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router } from '@angular/router';
import { EMPTY, catchError } from 'rxjs';
import { TodayStoryItem } from '../../models/today-stories';
import { GalleryTimelineMonth, GalleryTimelineYear } from '../../models/gallery-browser';
import { MediaRead } from '../../models/media';
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
import {
  BulkMetadataDialogComponent,
  BulkMetadataDialogResult,
} from './bulk-metadata-dialog/bulk-metadata-dialog.component';
import { MediaSearchParams } from '../../services/web/media-client.service';
import { MediaService } from '../../services/media.service';
import { MediaNavigator, parseMediaUrl } from '../../services/media-navigator.service';

interface LayerOpenPoint {
  mediaId: string;
  query: string;
  viewportTop: number | null;
}

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
  skeletonHeight?: number | null;
}

interface ScrollAnchor {
  element: HTMLElement;
  top: number;
  month: HTMLElement | null;
  monthTop: number;
  scrollY: number;
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
const VIRTUAL_OVERSCAN_PX = 1400;
const SKELETON_RENDER_LIMIT = 240;
const HIGHLIGHT_DURATION_MS = 1600;
const REVEAL_MAX_FRAMES = 60;
const MIN_ESTIMATE_SCALE = 0.5;
const MAX_ESTIMATE_SCALE = 3;
const DAY_HEADER_ESTIMATE = 42;
const DAY_SECTION_MARGIN = 28;
const MONTH_SECTION_MARGIN = 40;

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
  readonly dayGroups = input<DayGroup[]>([]);
  readonly timeline = input<TimelineBucket[]>([]);
  readonly loading = input(false);
  readonly showTimeline = input(true);
  readonly allowSelection = input(true);
  readonly selectionActionMode = input<'default' | 'trash'>('default');
  readonly emptyStateTitle = input('No media yet');
  readonly emptyStateMessage = input('Media you have access to will appear here.');
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
  private readonly zone = inject(NgZone);
  private readonly mediaService = inject(MediaService);
  private readonly mediaNavigator = inject(MediaNavigator);
  private readonly injector = inject(Injector);

  @ViewChildren('monthSection', { read: ElementRef })
  private readonly monthSections?: QueryList<ElementRef<HTMLElement>>;

  @ViewChild('contentPane', { read: ElementRef })
  private readonly contentPane?: ElementRef<HTMLElement>;

  @ViewChild('virtualList', { read: ElementRef })
  private readonly virtualList?: ElementRef<HTMLElement>;

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
  readonly virtualMonthMetrics = computed(() => this.buildVirtualMonthMetrics());
  readonly renderedMonthMetrics = computed(() => this.buildRenderedMonthMetrics());
  readonly virtualMonthGroups = computed(() => this.buildVirtualMonthGroups());
  readonly totalVirtualHeight = computed(() => {
    const metrics = this.virtualMonthMetrics();
    const last = metrics[metrics.length - 1];
    return last ? last.offset + last.height : 0;
  });
  readonly topSpacerHeight = computed(() => this.renderedMonthMetrics()[0]?.offset ?? 0);
  readonly bottomSpacerHeight = computed(() => {
    const rendered = this.renderedMonthMetrics();
    const last = rendered[rendered.length - 1];
    if (!last) {
      return 0;
    }
    return Math.max(this.totalVirtualHeight() - (last.offset + last.height), 0);
  });
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
  private pendingJumpRetryTimer?: ReturnType<typeof setTimeout>;
  private pendingJumpFinalizeTimer?: ReturnType<typeof setTimeout>;
  private openPoint: LayerOpenPoint | null = null;
  private pendingJumpTargetKey: string | null = null;
  private readonly scrollTop = signal(0);
  private readonly viewportHeight = signal(900);
  private readonly measuredMonthHeights = signal<Record<string, number>>({});
  private readonly estimateScale = signal(1);
  private scrollAnchor: ScrollAnchor | null = null;
  private previousMetrics: MonthMetric[] = [];
  private pendingScrollShift = 0;
  private highlightTimer?: ReturnType<typeof setTimeout>;

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
        this.scheduleLayoutSync();
        this.ensureRenderedMonthsLoaded();
      });
    });

    effect(() => {
      const metrics = this.virtualMonthMetrics();
      untracked(() => this.compensateMetricShift(metrics));
    });

    afterEveryRender({ write: () => this.restoreScrollAnchor() });

    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.onNavigationEnd(event.urlAfterRedirects);
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
    clearTimeout(this.pendingJumpRetryTimer);
    clearTimeout(this.pendingJumpFinalizeTimer);
    clearTimeout(this.highlightTimer);
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
    this.openPoint = this.captureOpenPoint(media.id, parseMediaUrl(this.router.url).query);
    this.mediaNavigator.open(media.id);
  }

  onStoryReveal(item: TodayStoryItem): void {
    this.galleryStore.ensureMediaLoaded(item)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((found) => {
        if (!found) {
          this.snackBar.open('Could not find this memory in the timeline.', 'Close', { duration: 3500 });
          return;
        }
        const monthKey = (item.metadata.captured_at || item.uploaded_at).slice(0, 7);
        afterNextRender(() => this.revealMedia(item.id, true, monthKey), { injector: this.injector });
      });
  }

  onStoryOpen(item: TodayStoryItem): void {
    this.galleryStore.ensureMediaLoaded(item)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.onMediaActivated(item));
  }

  revealMedia(mediaId: string, highlight = true, monthKey?: string): void {
    const card = this.findMediaCardElement(mediaId);
    if (card) {
      this.centerCard(card, highlight);
      return;
    }

    const key = monthKey ?? this.dayGroups()
      .find((group) => group.items.some((item) => item.id === mediaId))
      ?.date.slice(0, 7);
    const metric = this.virtualMonthMetrics().find((candidate) => candidate.key === key);
    if (!metric) {
      this.centerCardWhenRendered(mediaId, highlight, REVEAL_MAX_FRAMES);
      return;
    }

    this.scrollDocumentToLocalTop(metric.offset);
    this.scrollTop.set(this.readLocalScrollTop());
    this.ensureRenderedMonthsLoaded();
    this.centerCardWhenRendered(mediaId, highlight, REVEAL_MAX_FRAMES);
  }

  private centerCardWhenRendered(mediaId: string, highlight: boolean, framesLeft: number): void {
    requestAnimationFrame(() => {
      const target = this.findMediaCardElement(mediaId);
      if (target) {
        this.centerCard(target, highlight);
        return;
      }
      if (framesLeft > 0) {
        this.centerCardWhenRendered(mediaId, highlight, framesLeft - 1);
      }
    });
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

  editSelectionMetadata(): void {
    const ids = this.selectedIds();
    if (ids.length === 0) {
      return;
    }

    this.dialog
      .open(BulkMetadataDialogComponent, {
        data: { selectedCount: ids.length },
        maxWidth: '760px',
        width: '100%',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value: BulkMetadataDialogResult | undefined) => {
        if (!value) {
          return;
        }

        this.galleryStore
          .batchUpdateAnnotations({ media_ids: ids, ...value })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((result) => {
            this.clearSelection();
            this.snackBar.open(
              `Updated metadata for ${result.processed} item${result.processed === 1 ? '' : 's'}.`,
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
        this.measuredMonthHeights.set({});
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

  private onNavigationEnd(url: string): void {
    const { mediaId, query } = parseMediaUrl(url);
    if (mediaId !== null) {
      this.openPoint ??= this.captureOpenPoint(mediaId, query);
      return;
    }

    const openPoint = this.openPoint;
    const lastViewedId = this.mediaNavigator.lastViewedId();
    this.openPoint = null;
    this.mediaNavigator.lastViewedId.set(null);
    if (openPoint && openPoint.query === query) {
      this.reconcilePositionAfterClose(openPoint, lastViewedId ?? openPoint.mediaId);
    }
  }

  private captureOpenPoint(mediaId: string, query: string): LayerOpenPoint {
    return {
      mediaId,
      query,
      viewportTop: this.findMediaCardElement(mediaId)?.getBoundingClientRect().top ?? null,
    };
  }

  private reconcilePositionAfterClose(openPoint: LayerOpenPoint, mediaId: string): void {
    const card = this.findMediaCardElement(mediaId);
    if (card && mediaId === openPoint.mediaId && openPoint.viewportTop !== null) {
      const delta = card.getBoundingClientRect().top - openPoint.viewportTop;
      if (Math.abs(delta) > 0.5) {
        window.scrollBy({ top: delta, behavior: 'instant' });
        this.recordScrollAnchor();
      }
      this.focusCard(card);
      return;
    }

    if (card && this.isInViewport(card)) {
      this.focusCard(card);
      return;
    }

    this.revealMedia(mediaId, false);
  }

  private centerCard(card: HTMLElement, highlight: boolean): void {
    if (typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    this.scrollTop.set(this.readLocalScrollTop());
    this.recordScrollAnchor();
    this.focusCard(card);
    if (highlight) {
      this.highlightCard(card);
    }
  }

  private highlightCard(card: HTMLElement): void {
    clearTimeout(this.highlightTimer);
    document
      .querySelectorAll('.media-browser__card--highlight')
      .forEach((element) => element.classList.remove('media-browser__card--highlight'));
    card.classList.add('media-browser__card--highlight');
    this.highlightTimer = setTimeout(
      () => card.classList.remove('media-browser__card--highlight'),
      HIGHLIGHT_DURATION_MS,
    );
  }

  private recordScrollAnchor(): void {
    this.scrollAnchor = this.findScrollAnchor();
  }

  private findScrollAnchor(): ScrollAnchor | null {
    const list = this.virtualList?.nativeElement;
    if (!list || typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
      return null;
    }

    const listRect = list.getBoundingClientRect();
    if (listRect.top >= 0 || listRect.bottom <= 0) {
      return null;
    }

    const focused = document.activeElement?.closest<HTMLElement>('zukan-media-card') ?? null;
    const probeX = listRect.left + Math.min(24, listRect.width / 2);
    const candidates = [
      focused && list.contains(focused) && this.isInViewport(focused) ? focused : null,
      ...[8, 64, 160].map((probeY) =>
        document.elementFromPoint(probeX, probeY)?.closest<HTMLElement>(
          'zukan-media-card, .media-browser__day-header, .media-browser__month',
        ) ?? null,
      ),
    ];
    for (const element of candidates) {
      if (element && list.contains(element)) {
        const month = element.closest<HTMLElement>('.media-browser__month');
        return {
          element,
          top: element.getBoundingClientRect().top,
          month,
          monthTop: month?.getBoundingClientRect().top ?? 0,
          scrollY: this.readDocumentScrollTop(),
        };
      }
    }

    return null;
  }

  private viewportShowsList(): boolean {
    const list = this.virtualList?.nativeElement;
    if (!list || typeof document.elementFromPoint !== 'function') {
      return false;
    }

    const listRect = list.getBoundingClientRect();
    const hit = document.elementFromPoint(listRect.left + Math.min(24, listRect.width / 2), 160);
    return !!hit && list.contains(hit);
  }

  private restoreScrollAnchor(): void {
    const anchor = this.scrollAnchor;
    const pendingShift = this.pendingScrollShift;
    this.pendingScrollShift = 0;
    const scrolledSince = anchor ? this.readDocumentScrollTop() - anchor.scrollY : 0;
    if (anchor?.element.isConnected) {
      const delta = anchor.element.getBoundingClientRect().top - (anchor.top - scrolledSince);
      if (Math.abs(delta) > 1) {
        window.scrollBy({ top: delta, behavior: 'instant' });
      }
    } else if (anchor?.month?.isConnected) {
      const delta = anchor.month.getBoundingClientRect().top - (anchor.monthTop - scrolledSince);
      if (Math.abs(delta) > 1) {
        window.scrollBy({ top: delta, behavior: 'instant' });
      }
    } else if (pendingShift !== 0 && this.viewportShowsList()) {
      window.scrollBy({ top: pendingShift, behavior: 'instant' });
    }

    if (this.virtualList) {
      this.scrollTop.set(this.readLocalScrollTop());
    }
    this.recordScrollAnchor();
  }

  private isInViewport(element: HTMLElement): boolean {
    const { top, bottom } = element.getBoundingClientRect();
    return bottom > 0 && top < window.innerHeight;
  }

  private focusCard(card: HTMLElement): void {
    card.querySelector<HTMLElement>('.media-card')?.focus({ preventScroll: true });
  }

  private findMediaCardElement(mediaId: string): HTMLElement | null {
    if (typeof document === 'undefined') {
      return null;
    }

    const cards = document.querySelectorAll<HTMLElement>('zukan-media-card[data-media-id]');
    for (const card of Array.from(cards)) {
      if (card.getAttribute('data-media-id') === mediaId) {
        return card;
      }
    }

    return null;
  }

  private watchContentScroll(): void {
    const content = this.contentPane?.nativeElement;
    if (!content || this.removeContentScrollListener) {
      return;
    }

    this.zone.runOutsideAngular(() => {
      const onScroll = () => {
        this.scrollTop.set(this.readLocalScrollTop());
        this.viewportHeight.set(this.readViewportHeight());
        this.recordScrollAnchor();
        this.scheduleActiveSectionSync();
        this.ensureRenderedMonthsLoaded();
      };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      this.removeContentScrollListener = () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        this.removeContentScrollListener = undefined;
      };
    });
  }

  private syncMonthMetrics(): void {
    const content = this.contentPane?.nativeElement;
    const sections = this.monthSections?.toArray() ?? [];
    if (!content || sections.length === 0) {
      this.updateVirtualScrollBounds();
      return;
    }

    const heights: Record<string, number> = { ...this.measuredMonthHeights() };
    const loadedCounts = this.loadedCountsByMonth();
    const buckets = new Map(
      this.timeline().map((bucket) => [this.monthKey(bucket.year, bucket.month), bucket] as const),
    );
    for (const ref of sections) {
      const el = ref.nativeElement;
      const key = el.dataset['month'];
      if (!key || el.querySelector('.media-browser__day--skeleton')) {
        continue;
      }

      const measured = el.getBoundingClientRect().height || el.offsetHeight;
      if (measured <= 0) {
        continue;
      }
      const total = buckets.get(key)?.count ?? 0;
      const loaded = loadedCounts.get(key) ?? 0;
      const partial = this.galleryStore.monthMap().get(key)?.hasMore && loaded > 0 && total > loaded;
      heights[key] = partial ? measured * (total / loaded) : measured;
    }

    this.measuredMonthHeights.set(heights);
    this.updateEstimateScale(heights, loadedCounts);
    this.monthMetrics.set(this.renderedMonthMetrics());
    this.updateVirtualScrollBounds();
  }

  private compensateMetricShift(metrics: MonthMetric[]): void {
    const previous = this.previousMetrics;
    this.previousMetrics = metrics;
    const scrollTop = this.scrollTop();
    if (previous.length === 0 || scrollTop <= 0) {
      return;
    }

    const anchorBefore = this.findActiveMonthMetric(previous, scrollTop);
    const anchorAfter = anchorBefore
      ? metrics.find((metric) => metric.key === anchorBefore.key)
      : undefined;
    if (!anchorBefore || !anchorAfter) {
      return;
    }

    const within = scrollTop - anchorBefore.offset;
    const proportional = anchorBefore.height > 0
      && this.isUnloadedPosition(anchorBefore.key, within, anchorBefore.height);
    const nextTop = proportional
      ? anchorAfter.offset + within * (anchorAfter.height / anchorBefore.height)
      : anchorAfter.offset + within;
    const shift = nextTop - scrollTop;
    if (Math.abs(shift) <= 0.5) {
      return;
    }

    this.scrollTop.set(Math.max(scrollTop + shift, 0));
    if (proportional) {
      this.scrollAnchor = null;
    }
    if (shift > 0 || typeof window === 'undefined') {
      this.pendingScrollShift += shift;
      return;
    }

    window.scrollBy({ top: shift, behavior: 'instant' });
    if (this.scrollAnchor) {
      this.scrollAnchor = { ...this.scrollAnchor, scrollY: this.readDocumentScrollTop() };
    }
  }

  private isUnloadedPosition(monthKey: string, within: number, height: number): boolean {
    const state = this.galleryStore.monthMap().get(monthKey);
    if (!state?.loaded) {
      return true;
    }
    if (!state.hasMore) {
      return false;
    }

    const total = Math.max(state.estimatedCount, state.items.length, 1);
    return within > height * (state.items.length / total);
  }

  private loadedCountsByMonth(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const group of this.dayGroups()) {
      const key = group.date.slice(0, 7);
      counts.set(key, (counts.get(key) ?? 0) + group.items.length);
    }
    return counts;
  }

  private updateEstimateScale(heights: Record<string, number>, loadedCounts: Map<string, number>): void {
    const contentWidth = this.contentWidth();
    const rowHeight = this.preferredRowHeight(contentWidth);
    const gap = this.gridGap(contentWidth);
    let measuredSum = 0;
    let estimatedSum = 0;
    for (const bucket of this.timeline()) {
      const key = this.monthKey(bucket.year, bucket.month);
      const height = heights[key];
      if (height === undefined || (loadedCounts.get(key) ?? 0) < bucket.count) {
        continue;
      }
      measuredSum += height;
      estimatedSum += this.estimateBucketHeight(bucket, contentWidth, rowHeight, gap);
    }

    if (estimatedSum <= 0) {
      return;
    }

    const next = this.clamp(measuredSum / estimatedSum, MIN_ESTIMATE_SCALE, MAX_ESTIMATE_SCALE);
    if (Math.abs(next - this.estimateScale()) / this.estimateScale() > 0.02) {
      this.estimateScale.set(next);
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
    const metrics = this.virtualMonthMetrics();
    if (!this.contentPane?.nativeElement || metrics.length === 0) {
      this.activeYear.set(null);
      this.activeMonthKey.set(null);
      this.activeTimelineProgress.set(null);
      return;
    }

    const scrollTop = this.readLocalScrollTop();
    this.scrollTop.set(scrollTop);
    const activeMetric = this.findActiveMonthMetric(metrics, scrollTop);

    this.activeTimelineProgress.set(this.localTopToProgress(scrollTop) * 100);
    this.activeYear.set(activeMetric?.year ?? null);
    this.activeMonthKey.set(activeMetric?.key ?? null);
  }

  private buildTimelineEntries(): GalleryTimelineYear[] {
    const buckets = this.timeline();
    if (buckets.length === 0) {
      return [];
    }

    const renderedMonthKeys = new Set(
      this.virtualMonthGroups()
        .filter((mg) => mg.days.some((d) => !d.isSkeleton))
        .map((mg) => this.monthKey(mg.year, mg.month)),
    );
    const totalCount = buckets.reduce((sum, bucket) => sum + Math.max(bucket.count, 0), 0);
    const years: GalleryTimelineYear[] = [];
    const yearMap = new Map<number, GalleryTimelineYear>();
    let cumulativeCount = 0;

    for (const bucket of buckets) {
      let entry = yearMap.get(bucket.year);
      if (!entry) {
        entry = { year: bucket.year, count: 0, months: [] };
        yearMap.set(bucket.year, entry);
        years.push(entry);
      }

      entry.count += bucket.count;
      entry.months.push({
        year: bucket.year,
        month: bucket.month,
        count: bucket.count,
        position: totalCount > 0 ? (cumulativeCount / totalCount) * 100 : 0,
        rendered: renderedMonthKeys.has(this.monthKey(bucket.year, bucket.month)),
        anchorId: this.monthSectionId(bucket.year, bucket.month),
      });
      cumulativeCount += Math.max(bucket.count, 0);
    }

    return years;
  }

  private progressToLocalTop(progress: number): number {
    const metrics = this.virtualMonthMetrics();
    const buckets = this.timeline();
    const totalHeight = this.totalVirtualHeight();
    const maxScrollTop = this.maxScrollTop();
    const totalCount = buckets.reduce((sum, bucket) => sum + Math.max(bucket.count, 0), 0);
    const clamped = this.clamp(progress, 0, 1);
    if (metrics.length !== buckets.length || totalCount <= 0 || totalHeight <= 0) {
      return clamped * maxScrollTop;
    }

    if (clamped >= 1) {
      return maxScrollTop;
    }

    const targetCount = clamped * totalCount;
    let cumulative = 0;
    let y = totalHeight;
    for (let index = 0; index < metrics.length; index += 1) {
      const count = Math.max(buckets[index]!.count, 0);
      if (targetCount <= cumulative + count || index === metrics.length - 1) {
        const fraction = count > 0 ? this.clamp((targetCount - cumulative) / count, 0, 1) : 0;
        y = metrics[index]!.offset + fraction * metrics[index]!.height;
        break;
      }
      cumulative += count;
    }

    return Math.min(y, maxScrollTop);
  }

  private localTopToProgress(localTop: number): number {
    const metrics = this.virtualMonthMetrics();
    const buckets = this.timeline();
    const totalHeight = this.totalVirtualHeight();
    const maxScrollTop = this.maxScrollTop();
    const totalCount = buckets.reduce((sum, bucket) => sum + Math.max(bucket.count, 0), 0);
    if (maxScrollTop <= 0) {
      return 0;
    }
    if (metrics.length !== buckets.length || totalCount <= 0 || totalHeight <= 0) {
      return this.clamp(localTop / maxScrollTop, 0, 1);
    }

    if (localTop >= maxScrollTop - 1) {
      return 1;
    }

    const y = Math.max(localTop, 0);
    const metric = this.findActiveMonthMetric(metrics, y - 1);
    if (!metric) {
      return 0;
    }

    let cumulative = 0;
    for (let index = 0; index < metrics.length; index += 1) {
      const count = Math.max(buckets[index]!.count, 0);
      if (metrics[index]!.key === metric.key) {
        const fraction = metric.height > 0 ? this.clamp((y - metric.offset) / metric.height, 0, 1) : 0;
        return this.clamp((cumulative + fraction * count) / totalCount, 0, 1);
      }
      cumulative += count;
    }

    return 1;
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

    this.galleryStore.ensureMonthWindow(targetKey)
      .pipe(takeUntilDestroyed(this.destroyRef), catchError(() => EMPTY))
      .subscribe(() => this.scheduleLayoutSync());

    const targetElement = typeof document !== 'undefined'
      ? document.getElementById(target.anchorId)
      : null;
    const targetHasLoadedDays = this.dayGroups().some((group) => group.date.slice(0, 7) === targetKey);
    const targetReady = targetElement
      && targetHasLoadedDays
      && !targetElement.querySelector('.media-browser__day--skeleton');
    if (targetReady) {
      this.scrollElementIntoDocumentView(targetElement);
      this.schedulePendingJumpFinalize(targetKey, target.anchorId);
      return;
    }

    if (this.scrollToAnchor(target.anchorId)) {
      this.schedulePendingJumpRetry();
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
    const content = this.scrollOrigin();
    if (!content) {
      return false;
    }

    const cachedMonthMetric = this.virtualMonthMetrics().find(
      (metric) => this.monthSectionId(metric.year, metric.month) === anchorId,
    );
    const target = typeof document !== 'undefined' ? document.getElementById(anchorId) : null;
    if (!cachedMonthMetric && !target) {
      return false;
    }
    const nextTop = target
      ? this.measureOffsetWithinContent(target, content)
      : cachedMonthMetric!.offset;
    this.scrollDocumentToLocalTop(nextTop);
    this.scrollTop.set(this.readLocalScrollTop());
    this.scheduleActiveSectionSync();
    this.ensureRenderedMonthsLoaded();
    return true;
  }

  private scrollElementIntoDocumentView(target: HTMLElement): void {
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
    } else {
      const content = this.scrollOrigin();
      if (content) {
        this.scrollDocumentToLocalTop(this.measureOffsetWithinContent(target, content));
      }
    }
    this.recordScrollAnchor();
    this.scrollTop.set(this.readLocalScrollTop());
    this.scheduleActiveSectionSync();
    this.ensureRenderedMonthsLoaded();
  }

  private schedulePendingJumpRetry(): void {
    if (this.pendingJumpRetryTimer) {
      return;
    }

    this.pendingJumpRetryTimer = setTimeout(() => {
      this.pendingJumpRetryTimer = undefined;
      this.tryResolvePendingJump();
    }, 0);
  }

  private schedulePendingJumpFinalize(targetKey: string, anchorId: string): void {
    if (this.pendingJumpFinalizeTimer) {
      return;
    }

    let attempts = 0;
    const correct = () => {
      if (this.pendingJumpTargetKey !== targetKey) {
        this.pendingJumpFinalizeTimer = undefined;
        return;
      }

      const target = typeof document !== 'undefined' ? document.getElementById(anchorId) : null;
      if (target) {
        this.scrollElementIntoDocumentView(target);
      } else {
        this.scrollToAnchor(anchorId);
      }
      attempts += 1;
      if (attempts < 4) {
        this.pendingJumpFinalizeTimer = setTimeout(correct, attempts * 160);
        return;
      }

      this.pendingJumpFinalizeTimer = undefined;
      this.pendingJumpTargetKey = null;
    };

    this.pendingJumpFinalizeTimer = setTimeout(correct, 80);
  }

  private measureOffsetWithinContent(target: HTMLElement, content: HTMLElement): number {
    const contentRect = content.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    return targetRect.top - contentRect.top;
  }

  private flattenTimelineMonths() {
    return this.timelineEntries().flatMap((entry) => entry.months);
  }

  private buildVirtualMonthGroups(): JustifiedMonthGroup[] {
    if (this.timeline().length === 0) {
      return this.buildJustifiedMonthGroups();
    }

    const metricsByKey = new Map(this.renderedMonthMetrics().map((metric) => [metric.key, metric] as const));
    const rendered = new Set(metricsByKey.keys());
    const loadedGroups = new Map(
      this.buildJustifiedMonthGroups().map((group) => [this.monthKey(group.year, group.month), group] as const),
    );
    const contentWidth = this.contentWidth();
    const rowHeight = this.preferredRowHeight(contentWidth);
    const gap = this.gridGap(contentWidth);
    const result: JustifiedMonthGroup[] = [];

    for (const bucket of this.timeline()) {
      const key = this.monthKey(bucket.year, bucket.month);
      if (!rendered.has(key)) {
        continue;
      }

      const loaded = loadedGroups.get(key);
      if (loaded && loaded.days.some((day) => !day.isSkeleton)) {
        const loadedCount = loaded.days.reduce((sum, day) => sum + day.itemCount, 0);
        const remaining = bucket.count - loadedCount;
        if (this.galleryStore.monthMap().get(key)?.hasMore && remaining > 0) {
          const metric = metricsByKey.get(key);
          result.push({
            ...loaded,
            days: [
              ...loaded.days,
              {
                ...this.buildSkeletonGroup({ ...bucket, count: remaining }, contentWidth, rowHeight, gap, metric?.height ?? null),
                date: `${key}-more`,
                label: 'Loading more…',
              },
            ],
            skeletonHeight: metric?.height ?? null,
          });
          continue;
        }
        result.push(loaded);
        continue;
      }

      const skeletonHeight = metricsByKey.get(key)?.height ?? null;
      result.push({
        year: bucket.year,
        month: bucket.month,
        label: this.formatMonthLabel(bucket.year, bucket.month),
        days: [this.buildSkeletonGroup(bucket, contentWidth, rowHeight, gap, skeletonHeight)],
        skeletonHeight,
      });
    }

    return result;
  }

  private buildVirtualMonthMetrics(): MonthMetric[] {
    const buckets = this.timeline();
    const measured = this.measuredMonthHeights();
    const contentWidth = this.contentWidth();
    const rowHeight = this.preferredRowHeight(contentWidth);
    const gap = this.gridGap(contentWidth);

    if (buckets.length === 0) {
      const groups = this.buildJustifiedMonthGroups();
      let offset = 0;
      return groups.map((group) => {
        const key = this.monthKey(group.year, group.month);
        const height = measured[key] ?? this.estimateMonthGroupHeight(group);
        const metric = { key, year: group.year, month: group.month, offset, height };
        offset += height;
        return metric;
      });
    }

    const groups = new Map(
      this.buildJustifiedMonthGroups()
        .filter((group) => group.days.some((day) => !day.isSkeleton))
        .map((group) => [this.monthKey(group.year, group.month), group] as const),
    );
    const loadedCounts = this.loadedCountsByMonth();
    const scale = this.estimateScale();
    let offset = 0;
    return buckets.map((bucket) => {
      const key = this.monthKey(bucket.year, bucket.month);
      const group = groups.get(key);
      const loaded = loadedCounts.get(key) ?? 0;
      const groupHeight = group && loaded > 0
        ? this.estimateMonthGroupHeight(group) * Math.max(bucket.count / loaded, 1)
        : null;
      const height = measured[key]
        ?? groupHeight
        ?? this.estimateBucketHeight(bucket, contentWidth, rowHeight, gap) * scale;
      const metric = { key, year: bucket.year, month: bucket.month, offset, height };
      offset += height;
      return metric;
    });
  }

  private buildRenderedMonthMetrics(): MonthMetric[] {
    const metrics = this.virtualMonthMetrics();
    if (metrics.length === 0) {
      return [];
    }

    const last = metrics[metrics.length - 1]!;
    const maxTop = Math.max(last.offset + last.height - this.viewportHeight(), 0);
    const top = Math.min(this.scrollTop(), maxTop);
    const from = Math.max(top - VIRTUAL_OVERSCAN_PX, 0);
    const to = top + this.viewportHeight() + VIRTUAL_OVERSCAN_PX;
    return metrics.filter((metric) => metric.offset + metric.height >= from && metric.offset <= to);
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
    fillHeight: number | null = null,
  ): JustifiedDayGroup {
    const itemsPerRow = Math.max(
      1,
      Math.floor((contentWidth + gap) / (rowHeight * SKELETON_ASPECT_RATIO + gap)),
    );
    const rowsToFill = fillHeight ? Math.ceil(fillHeight / (rowHeight + gap)) : Infinity;
    const count = Math.min(bucket.count, SKELETON_RENDER_LIMIT, rowsToFill * itemsPerRow);
    return {
      date: this.monthKey(bucket.year, bucket.month),
      label: this.formatMonthLabel(bucket.year, bucket.month),
      itemCount: bucket.count,
      rows: this.justifySkeletonRows(count, contentWidth, rowHeight, gap),
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
    if (!this.contentPane?.nativeElement) {
      return;
    }

    this.scrollDocumentToLocalTop(this.progressToLocalTop(progress));
    this.scrollTop.set(this.readLocalScrollTop());
    this.scheduleActiveSectionSync();
    this.ensureRenderedMonthsLoaded();
  }

  private updateVirtualScrollBounds(): void {
    if (!this.contentPane?.nativeElement) {
      return;
    }

    const viewportHeight = this.readViewportHeight();
    this.viewportHeight.set(viewportHeight);
    this.scrollTop.set(this.readLocalScrollTop());
    const nextMaxScrollTop = Math.max(this.totalVirtualHeight() - viewportHeight, 0);
    if (nextMaxScrollTop !== this.maxScrollTop()) {
      this.maxScrollTop.set(nextMaxScrollTop);
    }
  }

  private ensureRenderedMonthsLoaded(): void {
    if (this.timeline().length === 0) {
      return;
    }

    const visibleTo = this.scrollTop() + this.viewportHeight();
    for (const metric of this.renderedMonthMetrics()) {
      if (metric.offset > visibleTo) {
        continue;
      }
      const monthState = this.galleryStore.monthMap().get(metric.key);
      const total = Math.max(monthState?.estimatedCount ?? 0, monthState?.items.length ?? 0, 1);
      const loadedBottom = metric.offset + metric.height * ((monthState?.items.length ?? 0) / total);
      const request = monthState?.loaded && monthState.hasMore
        && this.scrollTop() + this.viewportHeight() + 800 > loadedBottom
        ? this.galleryStore.loadMoreForMonth(metric.key)
        : this.galleryStore.ensureMonthWindow(metric.key);

      request.pipe(takeUntilDestroyed(this.destroyRef), catchError(() => EMPTY))
        .subscribe(() => this.scheduleLayoutSync());
    }
  }

  private estimateMonthGroupHeight(group: JustifiedMonthGroup): number {
    const gap = this.gridGap(this.contentWidth());
    const daysHeight = group.days.reduce((sum, day, dayIndex) => {
      const rowsHeight = day.rows.reduce((rowSum, row, rowIndex) =>
        rowSum + row.height + (rowIndex > 0 ? gap : 0), 0);
      return sum + DAY_HEADER_ESTIMATE + rowsHeight + (dayIndex > 0 ? DAY_SECTION_MARGIN : 0);
    }, 0);
    return daysHeight + MONTH_SECTION_MARGIN;
  }

  private estimateBucketHeight(
    bucket: TimelineBucket,
    contentWidth: number,
    rowHeight: number,
    gap: number,
  ): number {
    const count = Math.max(bucket.count, 0);
    if (count === 0) {
      return DAY_HEADER_ESTIMATE + MONTH_SECTION_MARGIN;
    }

    const minH = contentWidth < 1024 ? MIN_ROW_HEIGHT_COMPACT : MIN_ROW_HEIGHT;
    const maxH = contentWidth < 1024 ? MAX_ROW_HEIGHT_COMPACT : MAX_ROW_HEIGHT;
    const itemsPerRow = Math.max(
      1,
      Math.floor((contentWidth + gap) / (rowHeight * SKELETON_ASPECT_RATIO + gap)),
    );
    const justifiedRows = Math.floor(Math.max(count - 1, 0) / itemsPerRow);
    const totalRows = Math.ceil(count / itemsPerRow);
    const gapWidth = gap * Math.max(itemsPerRow - 1, 0);
    const naturalH = (contentWidth - gapWidth) / (itemsPerRow * SKELETON_ASPECT_RATIO);
    const justifiedRowHeight = this.clamp(naturalH, minH, maxH);
    const trailingRowHeight = Math.min(rowHeight, maxH);
    const rowsHeight =
      justifiedRows * justifiedRowHeight
      + trailingRowHeight
      + gap * Math.max(totalRows - 1, 0);
    return DAY_HEADER_ESTIMATE + rowsHeight + MONTH_SECTION_MARGIN;
  }

  private measureContentWidth(content: HTMLElement): number {
    const measured = Math.max(
      content.clientWidth,
      content.offsetWidth,
      Math.floor(content.getBoundingClientRect().width),
    );

    return Math.max(measured, 320);
  }

  private readViewportHeight(): number {
    if (typeof window === 'undefined') {
      return this.contentPane?.nativeElement.clientHeight || 900;
    }

    return window.innerHeight || document.documentElement.clientHeight || 900;
  }

  private readDocumentScrollTop(): number {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return 0;
    }

    return (
      window.scrollY ||
      document.scrollingElement?.scrollTop ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0
    );
  }

  private browserDocumentTop(): number {
    const origin = this.scrollOrigin();
    if (!origin || typeof document === 'undefined') {
      return 0;
    }

    return origin.getBoundingClientRect().top + this.readDocumentScrollTop();
  }

  private scrollOrigin(): HTMLElement | null {
    return this.virtualList?.nativeElement ?? this.contentPane?.nativeElement ?? null;
  }

  private readLocalScrollTop(): number {
    return Math.max(this.readDocumentScrollTop() - this.browserDocumentTop(), 0);
  }

  private scrollDocumentToLocalTop(localTop: number): void {
    if (typeof window === 'undefined') {
      return;
    }

    const top = this.browserDocumentTop() + Math.max(localTop, 0);
    window.scrollTo({ top, behavior: 'auto' });
    this.recordScrollAnchor();
  }

  private areMonthMetricsEqual(current: MonthMetric[], next: MonthMetric[]): boolean {
    if (current.length !== next.length) {
      return false;
    }

    return current.every((metric, index) => {
      const candidate = next[index];
      return (
        candidate != null &&
        metric.key === candidate.key &&
        metric.year === candidate.year &&
        metric.month === candidate.month &&
        metric.offset === candidate.offset &&
        metric.height === candidate.height
      );
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
