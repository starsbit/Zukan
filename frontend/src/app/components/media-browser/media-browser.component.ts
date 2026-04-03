import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  QueryList,
  ViewChild,
  ViewChildren,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { fromEvent } from 'rxjs';
import { GalleryTimelineYear } from '../../models/gallery-browser';
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

interface GallerySectionAnchor {
  id: string;
  date: string;
  year: number;
  month: number;
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

  @ViewChildren('daySection', { read: ElementRef })
  private readonly daySections?: QueryList<ElementRef<HTMLElement>>;

  @ViewChild('contentPane', { read: ElementRef })
  private readonly contentPane?: ElementRef<HTMLElement>;

  readonly activeYear = signal<number | null>(null);
  readonly activeMonthKey = signal<string | null>(null);
  readonly activeTimelineProgress = signal<number | null>(null);
  readonly contentWidth = signal(WIDTH_FALLBACK);
  readonly hoveredDay = signal<string | null>(null);
  readonly selectedIds = signal<string[]>([]);
  readonly isCompactLayout = computed(() => this.contentWidth() < 768);
  readonly isEmpty = computed(
    () => !this.loading() && this.dayGroups().length === 0 && this.timeline().length === 0,
  );
  readonly justifiedDayGroups = computed(() => this.buildJustifiedDayGroups());
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

  private readonly _sectionAnchors = signal<GallerySectionAnchor[]>([]);
  private resizeObserver?: ResizeObserver;
  private frameId: number | null = null;
  private pendingJumpTargetKey: string | null = null;

  private static readonly MONTH_FORMAT = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  constructor() {
    effect(() => {
      this.dayGroups();
      this.timeline();
      this.loading();
      if (!this.allowSelection() && this.selectedIds().length > 0) {
        this.selectedIds.set([]);
      }

      this.reconcileSelection();
      this.tryResolvePendingJump();
      this.scheduleActiveSectionSync();
    });
  }

  ngAfterViewInit(): void {
    this.observeContentWidth();
    this.watchContentScroll();
    this.watchDaySections();
    this.scheduleActiveSectionSync();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.frameId != null) {
      cancelAnimationFrame(this.frameId);
    }
  }

  onContentScroll(): void {
    this.scheduleActiveSectionSync();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.syncContentWidth();
    this.scheduleActiveSectionSync();
  }

  sectionId(date: string): string {
    return `gallery-day-${date}`;
  }

  monthKey(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  onMediaActivated(media: MediaRead): void {
    const items = this.dayGroups().flatMap((group) => group.items);
    this.dialog.open(MediaInspectorDialogComponent, {
      data: { items, activeMediaId: media.id },
      width: '100vw',
      maxWidth: '100vw',
      height: '100vh',
      maxHeight: '100vh',
      autoFocus: false,
      panelClass: 'media-inspector-dialog-panel',
    });
    this.mediaSelected.emit(media);
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

  private reconcileSelection(): void {
    const visibleIds = new Set(this.allMediaIds());
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
      this.contentWidth.set(Math.max(Math.floor(width), 320));
    });
    this.resizeObserver.observe(content);
  }

  private watchDaySections(): void {
    if (!this.daySections) {
      return;
    }

    this.daySections.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncSectionAnchors();
    });
    this.syncSectionAnchors();
  }

  private watchContentScroll(): void {
    const content = this.contentPane?.nativeElement;
    if (!content) {
      return;
    }

    fromEvent(content, 'scroll')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.scheduleActiveSectionSync();
      });
  }

  private syncSectionAnchors(): void {
    const sections = this.daySections?.toArray() ?? [];
    this._sectionAnchors.set(sections.map((sectionRef) => {
      const element = sectionRef.nativeElement;
      const date = element.dataset['date'] ?? '';
      const [year, month] = date.split('-').map((part) => Number(part));
      return {
        id: element.id,
        date,
        year,
        month,
      };
    }));
    this.tryResolvePendingJump();
    this.scheduleActiveSectionSync();
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

  private syncActiveSection(): void {
    const timelineMonths = this.flattenTimelineMonths();
    const content = this.contentPane?.nativeElement;
    if (!content || timelineMonths.length === 0) {
      this.activeYear.set(null);
      this.activeMonthKey.set(null);
      this.activeTimelineProgress.set(null);
      return;
    }

    const maxScrollTop = Math.max(content.scrollHeight - content.clientHeight, 0);
    const scrollProgress =
      maxScrollTop <= 0 ? 0 : this.clamp(content.scrollTop / maxScrollTop, 0, 1);
    const startPosition = timelineMonths[0]?.position ?? 0;
    const endPosition = timelineMonths[timelineMonths.length - 1]?.position ?? startPosition;
    const activePosition = startPosition + (endPosition - startPosition) * scrollProgress;
    const activeIndex = this.resolveActiveMonthIndex(
      timelineMonths,
      0,
      timelineMonths.length - 1,
      activePosition,
    );
    const activeMonth = timelineMonths[activeIndex] ?? timelineMonths[0];

    this.activeTimelineProgress.set(activePosition);
    this.activeYear.set(activeMonth?.year ?? null);
    this.activeMonthKey.set(
      activeMonth ? this.monthKey(activeMonth.year, activeMonth.month) : null,
    );
  }

  private buildTimelineEntries(): GalleryTimelineYear[] {
    const anchorMap = new Map<string, string>();
    const sectionAnchors = this._sectionAnchors();
    const sources =
      sectionAnchors.length > 0
        ? sectionAnchors
        : this.justifiedDayGroups().map((group) => {
            const parts = group.date.split('-').map((part) => Number(part));
            return {
              id: this.sectionId(group.date),
              date: group.date,
              year: parts[0]!,
              month: parts[1]!,
            };
          });

    for (const anchor of sources) {
      const key = this.monthKey(anchor.year, anchor.month);
      if (!anchorMap.has(key)) {
        anchorMap.set(key, anchor.id);
      }
    }

    const years: GalleryTimelineYear[] = [];
    const yearMap = new Map<number, GalleryTimelineYear>();

    const buckets = this.timeline();
    const totalBuckets = buckets.length;

    for (const [index, bucket] of buckets.entries()) {
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
        position: totalBuckets <= 1 ? 0 : (index / (totalBuckets - 1)) * 100,
        rendered: anchorMap.has(this.monthKey(bucket.year, bucket.month)),
        anchorId: anchorMap.get(this.monthKey(bucket.year, bucket.month)) ?? null,
      });
    }

    return years;
  }

  private tryResolvePendingJump(): void {
    const targetKey = this.pendingJumpTargetKey;
    if (!targetKey) {
      return;
    }

    const timelineMonths = this.flattenTimelineMonths();
    const targetIndex = timelineMonths.findIndex(
      (month) => this.monthKey(month.year, month.month) === targetKey,
    );

    if (targetIndex === -1) {
      this.pendingJumpTargetKey = null;
      return;
    }

    const target = timelineMonths[targetIndex];
    if (target?.anchorId && this.scrollToAnchor(target.anchorId)) {
      this.pendingJumpTargetKey = null;
    }
  }

  private scrollToAnchor(anchorId: string): boolean {
    const content = this.contentPane?.nativeElement;
    const target = typeof document !== 'undefined' ? document.getElementById(anchorId) : null;
    if (!content || !target) {
      return false;
    }

    const nextTop = this.measureOffsetWithinContent(target, content);
    if (typeof content.scrollTo === 'function') {
      content.scrollTo({ top: Math.max(nextTop, 0), behavior: 'auto' });
    } else {
      content.scrollTop = Math.max(nextTop, 0);
    }
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

  private flattenTimelineMonths() {
    return this.timelineEntries().flatMap((entry) => entry.months);
  }

  private resolveActiveMonthIndex(
    timelineMonths: Array<{ position: number }>,
    startIndex: number,
    endIndex: number,
    activePosition: number,
  ): number {
    let activeIndex = startIndex;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = startIndex; index <= endIndex; index += 1) {
      const distance = Math.abs((timelineMonths[index]?.position ?? 0) - activePosition);
      if (distance <= bestDistance) {
        bestDistance = distance;
        activeIndex = index;
      }
    }

    return activeIndex;
  }

  private buildJustifiedDayGroups(): JustifiedDayGroup[] {
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
      return this.dayGroups().map((group) => ({
        date: group.date,
        label: group.label,
        itemCount: group.items.length,
        rows: this.justifyRows(group.items, contentWidth, rowHeight, gap),
        isSkeleton: false,
      }));
    }

    const result: JustifiedDayGroup[] = [];
    for (const bucket of this.timeline()) {
      const key = this.monthKey(bucket.year, bucket.month);
      if (realGroupsByMonth.has(key)) {
        for (const group of realGroupsByMonth.get(key)!) {
          result.push({
            date: group.date,
            label: group.label,
            itemCount: group.items.length,
            rows: this.justifyRows(group.items, contentWidth, rowHeight, gap),
            isSkeleton: false,
          });
        }
      } else if (this.loading() || this.galleryStore.hasMore()) {
        result.push(this.buildSkeletonGroup(bucket, contentWidth, rowHeight, gap));
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
    const minH = contentWidth < 768 ? MIN_ROW_HEIGHT_COMPACT : MIN_ROW_HEIGHT;
    const maxH = contentWidth < 768 ? MAX_ROW_HEIGHT_COMPACT : MAX_ROW_HEIGHT;

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
    const minRowHeight = contentWidth < 768 ? MIN_ROW_HEIGHT_COMPACT : MIN_ROW_HEIGHT;
    const maxRowHeight = contentWidth < 768 ? MAX_ROW_HEIGHT_COMPACT : MAX_ROW_HEIGHT;

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
    return contentWidth < 768 ? MOBILE_GRID_GAP : DESKTOP_GRID_GAP;
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

    const maxScrollTop = Math.max(content.scrollHeight - content.clientHeight, 0);
    content.scrollTop = progress * maxScrollTop;
  }

  private measureContentWidth(content: HTMLElement): number {
    const measured = Math.max(
      content.clientWidth,
      content.offsetWidth,
      Math.floor(content.getBoundingClientRect().width),
    );

    return Math.max(measured, 320);
  }
}
