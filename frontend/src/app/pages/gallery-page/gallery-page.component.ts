import { AsyncPipe, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  NgZone,
  QueryList,
  ViewChild,
  ViewChildren,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';

import { MediaRead } from '../../models/api';
import { GalleryNavbarComponent } from '../../components/gallery-search/gallery-navbar/gallery-navbar.component';
import { GallerySearchState } from '../../components/gallery-search/gallery-search.models';
import { buildGalleryListQuery, createDefaultGallerySearchFilters } from '../../components/gallery-search/gallery-search.utils';
import { MediaService } from '../../services/media.service';
import { GalleryMediaCardComponent } from '../../components/gallery-media-card/gallery-media-card.component';
import { GalleryViewerComponent } from '../../components/gallery-viewer/gallery-viewer.component';
import { GalleryUploadStatusIslandComponent } from '../../components/gallery-upload-status-island/gallery-upload-status-island.component';
import { MediaUploadService } from '../../services/media-upload.service';

interface GalleryDayGroup {
  key: string;
  label: string;
  items: MediaRead[];
}

interface GalleryTimelineMarker {
  key: string;
  ariaLabel: string;
  year: string;
  topPercent: number;
}

interface GalleryTimelineYear {
  year: string;
  topPercent: number;
}

interface GalleryTimelineMetric {
  key: string;
  center: number;
  targetScrollTop: number;
}

const TIMELINE_EDGE_PERCENT = 1.5;
const TIMELINE_LABEL_HIDE_DELAY_MS = 1400;
const REGROUP_ANIMATION_MS = 280;

@Component({
  selector: 'app-gallery-page',
  imports: [
    AsyncPipe,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    RouterLink,
    RouterLinkActive,
    GalleryMediaCardComponent,
    GalleryNavbarComponent,
    GalleryViewerComponent,
    GalleryUploadStatusIslandComponent
  ],
  templateUrl: './gallery-page.component.html',
  styleUrl: './gallery-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryPageComponent implements OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly ngZone = inject(NgZone);
  private readonly route = inject(ActivatedRoute);
  private readonly mediaService = inject(MediaService);
  private readonly mediaUploadService = inject(MediaUploadService);

  @ViewChild('uploadInput') private uploadInput?: ElementRef<HTMLInputElement>;
  @ViewChild('galleryScroller') private galleryScroller?: ElementRef<HTMLElement>;
  @ViewChild('timelineTrack') private timelineTrack?: ElementRef<HTMLElement>;
  @ViewChildren('groupSection') private groupSections?: QueryList<ElementRef<HTMLElement>>;

  readonly items$ = this.mediaService.items$;
  readonly loading$ = this.mediaService.requestLoading$;
  readonly loaded$ = this.mediaService.loaded$;
  readonly error$ = this.mediaService.error$;
  readonly mutationPending$ = this.mediaService.mutationPending$;

  selectedMedia: MediaRead | null = null;
  dragActive = false;
  isTrashView = false;
  selectedMediaIds = new Set<string>();
  timelineMarkers: GalleryTimelineMarker[] = [];
  timelineYears: GalleryTimelineYear[] = [];
  activeTimelineKey: string | null = null;
  activeTimelineYear: string | null = null;
  activeTimelineLabel = '';
  activeTimelineTopPercent = 0;
  timelineCurrentLabelVisible = false;
  hoverTimelineLabel = '';
  hoverTimelineTopPercent: number | null = null;
  regroupAnimating = false;
  private currentItems: MediaRead[] = [];
  groupedItems: GalleryDayGroup[] = [];
  private dragDepth = 0;
  private hasRenderedItems = false;
  private timelineLabelHideTimeoutId: number | null = null;
  private regroupAnimationTimeoutId: number | null = null;
  private timelineDragging = false;
  private timelineMetrics: GalleryTimelineMetric[] = [];
  private maxTimelineScroll = 1;
  private timelineRefreshQueued = false;
  searchState: GallerySearchState = {
    searchText: '',
    filters: createDefaultGallerySearchFilters()
  };
  private activeQuery = buildGalleryListQuery(this.searchState.searchText, this.searchState.filters);

  constructor() {
    this.setCustomScrollbarMode(true);

    this.route.data
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data) => {
        this.isTrashView = data['state'] === 'trashed';
        this.selectedMedia = null;
        this.clearSelection();
        this.activeQuery = this.buildQueryForCurrentView();
        this.loadMedia(this.activeQuery);
      });

    this.mediaUploadService.refreshRequested$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.reload();
      });

    this.items$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => {
        const shouldAnimateRegroup = shouldAnimateGalleryRegroup(this.currentItems, items, this.hasRenderedItems);
        this.currentItems = items;
        this.groupedItems = buildGalleryDayGroups(items);
        this.hasRenderedItems = this.hasRenderedItems || items.length > 0;
        if (shouldAnimateRegroup) {
          this.triggerRegroupAnimation();
        }
        this.scheduleTimelineRefresh();
      });
  }

  ngOnDestroy(): void {
    this.timelineDragging = false;
    this.clearTimelineLabelHideTimeout();
    this.clearRegroupAnimationTimeout();
    this.setCustomScrollbarMode(false);
  }

  ngAfterViewInit(): void {
    this.groupSections?.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.scheduleTimelineRefresh();
      });

    this.scheduleTimelineRefresh();
  }

  reload(): void {
    this.loadMedia(this.activeQuery);
  }

  applySearch(searchState: GallerySearchState): void {
    this.searchState = searchState;
    this.activeQuery = this.buildQueryForCurrentView();
    this.clearSelection();
    this.loadMedia(this.activeQuery);
  }

  openMedia(media: MediaRead): void {
    if (this.selectionMode) {
      this.toggleSelection(media);
      return;
    }

    this.selectedMedia = media;
  }

  closeMedia(): void {
    this.selectedMedia = null;
  }

  openUploadPicker(): void {
    this.uploadInput?.nativeElement.click();
  }

  onUploadSelection(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);

    input.value = '';
    this.mediaUploadService.startUpload(files);
  }

  onDragEnter(event: DragEvent): void {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    this.dragDepth += 1;
    this.dragActive = true;
  }

  onDragOver(event: DragEvent): void {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    this.dragActive = true;
  }

  onDragLeave(event: DragEvent): void {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);

    if (this.dragDepth === 0) {
      this.dragActive = false;
    }
  }

  onDrop(event: DragEvent): void {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    this.dragDepth = 0;
    this.dragActive = false;
    this.mediaUploadService.startUpload(Array.from(event.dataTransfer?.files ?? []));
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.selectionMode) {
      if (
        event.key === 'Escape'
        && this.selectedMedia === null
        && !isEditableTarget(event.target)
        && this.searchState.searchText.trim()
      ) {
        event.preventDefault();
        this.applySearch({
          ...this.searchState,
          searchText: ''
        });
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.clearSelection();
      this.selectedMedia = null;
      return;
    }

    if (!isSelectAllShortcut(event) || isEditableTarget(event.target)) {
      return;
    }

    event.preventDefault();
    this.selectedMediaIds = new Set(this.currentItems.map((item) => item.id));
    this.selectedMedia = null;
  }

  onGalleryScroll(): void {
    this.showTimelineCurrentLabelTemporarily();
    this.scheduleTimelineRefresh();
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent): void {
    if (!this.timelineDragging) {
      return;
    }

    event.preventDefault();
    this.scrubTimelineToClientY(event.clientY);
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  onDocumentPointerEnd(): void {
    if (!this.timelineDragging) {
      return;
    }

    this.timelineDragging = false;
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.scheduleTimelineRefresh();
  }

  toggleSelection(media: MediaRead): void {
    const next = new Set(this.selectedMediaIds);

    if (next.has(media.id)) {
      next.delete(media.id);
    } else {
      next.add(media.id);
    }

    this.selectedMediaIds = next;

    if (this.selectionMode) {
      this.selectedMedia = null;
    }
  }

  selectGroup(group: GalleryDayGroup): void {
    if (group.items.length === 0) {
      return;
    }

    const next = new Set(this.selectedMediaIds);
    for (const item of group.items) {
      next.add(item.id);
    }

    this.selectedMediaIds = next;
    this.selectedMedia = null;
  }

  clearSelection(): void {
    this.selectedMediaIds = new Set<string>();
  }

  isSelected(mediaId: string): boolean {
    return this.selectedMediaIds.has(mediaId);
  }

  isGroupSelected(group: GalleryDayGroup): boolean {
    return group.items.length > 0 && group.items.every((item) => this.selectedMediaIds.has(item.id));
  }

  deleteSelected(): void {
    if (this.selectedMediaIds.size === 0) {
      return;
    }

    this.selectedMedia = null;
    this.mediaService.batchUpdateMedia({
      media_ids: Array.from(this.selectedMediaIds),
      deleted: true
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.clearSelection();
        },
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }

  restoreSelected(): void {
    if (this.selectedMediaIds.size === 0) {
      return;
    }

    this.selectedMedia = null;
    this.mediaService.restoreMediaBatch(Array.from(this.selectedMediaIds))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.clearSelection();
        },
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }

  restoreMedia(media: MediaRead): void {
    this.mediaService.restoreMedia(media.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (this.selectedMedia?.id === media.id) {
            this.selectedMedia = null;
          }

          if (this.isSelected(media.id)) {
            this.toggleSelection(media);
          }
        },
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }

  deleteMedia(media: MediaRead): void {
    this.mediaService.deleteMedia(media.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (this.selectedMedia?.id === media.id) {
            this.selectedMedia = null;
          }

          if (this.isSelected(media.id)) {
            this.toggleSelection(media);
          }
        },
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }

  emptyTrash(): void {
    this.selectedMedia = null;
    this.mediaService.emptyTrash()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.clearSelection();
        },
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }

  get selectionMode(): boolean {
    return this.selectedMediaIds.size > 0;
  }

  get selectedCount(): number {
    return this.selectedMediaIds.size;
  }

  onTimelinePointerMove(event: PointerEvent): void {
    this.showTimelineCurrentLabelTemporarily();
    this.updateTimelineHover(event.clientY);
  }

  onTimelinePointerLeave(): void {
    if (this.timelineDragging) {
      return;
    }

    this.clearTimelineHover();
  }

  onTimelinePointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    this.timelineDragging = true;
    this.showTimelineCurrentLabelTemporarily();
    this.scrubTimelineToClientY(event.clientY);
  }

  scrollToGroup(groupKey: string): void {
    const section = this.findGroupElement(groupKey);
    const scroller = this.galleryScroller?.nativeElement;
    if (!section) {
      return;
    }

    if (!scroller) {
      this.showTimelineCurrentLabelTemporarily();
      section.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
      return;
    }

    scroller.scrollTo({
      behavior: 'smooth',
      top: Math.max(0, section.offsetTop - getTimelineScrollOffset() - getGroupScrollTopAdjustment(section))
    });
    this.showTimelineCurrentLabelTemporarily();
  }

  scrollToYear(year: string): void {
    const firstGroup = this.groupedItems.find((group) => group.key.startsWith(`${year}-`));
    if (!firstGroup) {
      return;
    }

    this.scrollToGroup(firstGroup.key);
  }

  private loadMedia(query = this.activeQuery): void {
    this.mediaService.loadPage(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }

  private buildQueryForCurrentView() {
    const query = buildGalleryListQuery(this.searchState.searchText, this.searchState.filters);

    return this.isTrashView ? { ...query, state: 'trashed' as const } : query;
  }

  private scheduleTimelineRefresh(): void {
    if (this.timelineRefreshQueued) {
      return;
    }

    this.timelineRefreshQueued = true;

    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        this.timelineRefreshQueued = false;
        this.ngZone.run(() => {
          this.refreshTimeline();
        });
      });
    });
  }

  private refreshTimeline(): void {
    const sections = this.groupSections?.toArray() ?? [];
    const scroller = this.galleryScroller?.nativeElement;
    if (sections.length === 0 || this.groupedItems.length === 0 || !scroller) {
      this.timelineMarkers = [];
      this.timelineYears = [];
      this.activeTimelineKey = null;
      this.activeTimelineYear = null;
      this.activeTimelineLabel = '';
      this.activeTimelineTopPercent = 0;
      this.timelineCurrentLabelVisible = false;
      this.timelineMetrics = [];
      this.maxTimelineScroll = 1;
      this.clearTimelineHover();
      this.cdr.markForCheck();
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const metrics: GalleryTimelineMetric[] = sections.map((sectionRef, index) => {
      const element = sectionRef.nativeElement;
      const header = element.querySelector('.gallery-group-header') as HTMLElement | null;
      const anchor = header ?? element;
      const rect = anchor.getBoundingClientRect();
      const anchorTop = rect.top - scrollerRect.top + scroller.scrollTop;
      const targetScrollTop = Math.max(0, anchorTop - getTimelineScrollOffset());

      return {
        key: this.groupedItems[index]?.key ?? '',
        center: anchorTop + (rect.height / 2),
        targetScrollTop
      };
    }).filter((metric) => metric.key.length > 0);

    if (metrics.length === 0) {
      return;
    }

    const maxScroll = Math.max(
      scroller.scrollHeight - scroller.clientHeight,
      1
    );
    const currentScroll = Math.max(0, Math.min(scroller.scrollTop, maxScroll));
    this.timelineMetrics = metrics;
    this.maxTimelineScroll = maxScroll;

    this.timelineMarkers = metrics.map((metric) => ({
      key: metric.key,
      ariaLabel: formatTimelineMarkerLabel(metric.key),
      year: metric.key.slice(0, 4),
      topPercent: toTimelinePercent(metric.targetScrollTop / maxScroll)
    }));

    const years = new Map<string, GalleryTimelineYear>();
    for (const marker of this.timelineMarkers) {
      if (!years.has(marker.year)) {
        years.set(marker.year, {
          year: marker.year,
          topPercent: marker.topPercent
        });
      }
    }
    this.timelineYears = Array.from(years.values());

    const viewportTop = currentScroll + getTimelineScrollOffset();
    const activeMetric = metrics.reduce((closest, candidate) =>
      Math.abs(candidate.center - viewportTop) < Math.abs(closest.center - viewportTop) ? candidate : closest
    );

    this.activeTimelineKey = activeMetric.key;
    this.activeTimelineYear = activeMetric.key.slice(0, 4);
    this.activeTimelineLabel = formatTimelineCurrentLabel(activeMetric.key);
    this.activeTimelineTopPercent = toTimelinePercent(currentScroll / maxScroll);
    this.cdr.markForCheck();
  }

  private findGroupElement(groupKey: string): HTMLElement | null {
    const sections = this.groupSections?.toArray() ?? [];
    const index = this.groupedItems.findIndex((group) => group.key === groupKey);
    return index >= 0 ? sections[index]?.nativeElement ?? null : null;
  }

  private setCustomScrollbarMode(enabled: boolean): void {
    const html = this.document.documentElement;
    const body = this.document.body;

    html.classList.toggle('gallery-custom-scrollbar', enabled);
    body.classList.toggle('gallery-custom-scrollbar', enabled);
  }

  private scrubTimelineToClientY(clientY: number): void {
    const target = this.getTimelinePointerTarget(clientY);
    const scroller = this.galleryScroller?.nativeElement;
    if (!target || !scroller) {
      return;
    }

    scroller.scrollTop = target.scrollTop;
    this.hoverTimelineTopPercent = target.topPercent;
    this.hoverTimelineLabel = target.label;
    this.showTimelineCurrentLabelTemporarily();
    this.scheduleTimelineRefresh();
    this.cdr.markForCheck();
  }

  private updateTimelineHover(clientY: number): void {
    const target = this.getTimelinePointerTarget(clientY);
    if (!target) {
      return;
    }

    this.hoverTimelineTopPercent = target.topPercent;
    this.hoverTimelineLabel = target.label;
    this.cdr.markForCheck();
  }

  private clearTimelineHover(): void {
    if (!this.hoverTimelineLabel && this.hoverTimelineTopPercent === null) {
      return;
    }

    this.hoverTimelineLabel = '';
    this.hoverTimelineTopPercent = null;
    this.cdr.markForCheck();
  }

  private showTimelineCurrentLabelTemporarily(): void {
    this.timelineCurrentLabelVisible = true;
    this.clearTimelineLabelHideTimeout();

    if (typeof window !== 'undefined') {
      this.timelineLabelHideTimeoutId = window.setTimeout(() => {
        this.timelineCurrentLabelVisible = false;
        this.cdr.markForCheck();
      }, TIMELINE_LABEL_HIDE_DELAY_MS);
    }

    this.cdr.markForCheck();
  }

  private clearTimelineLabelHideTimeout(): void {
    if (this.timelineLabelHideTimeoutId === null || typeof window === 'undefined') {
      return;
    }

    window.clearTimeout(this.timelineLabelHideTimeoutId);
    this.timelineLabelHideTimeoutId = null;
  }

  private triggerRegroupAnimation(): void {
    this.regroupAnimating = false;
    this.clearRegroupAnimationTimeout();

    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        this.ngZone.run(() => {
          this.regroupAnimating = true;
          this.cdr.markForCheck();

          if (typeof window !== 'undefined') {
            this.regroupAnimationTimeoutId = window.setTimeout(() => {
              this.regroupAnimating = false;
              this.regroupAnimationTimeoutId = null;
              this.cdr.markForCheck();
            }, REGROUP_ANIMATION_MS);
          }
        });
      });
    });
  }

  private clearRegroupAnimationTimeout(): void {
    if (this.regroupAnimationTimeoutId === null || typeof window === 'undefined') {
      return;
    }

    window.clearTimeout(this.regroupAnimationTimeoutId);
    this.regroupAnimationTimeoutId = null;
  }

  private getTimelinePointerTarget(clientY: number): { topPercent: number; scrollTop: number; label: string } | null {
    const track = this.timelineTrack?.nativeElement;
    if (!track || this.timelineMetrics.length === 0) {
      return null;
    }

    const rect = track.getBoundingClientRect();
    if (rect.height <= 0) {
      return null;
    }

    const progress = clampUnit((clientY - rect.top) / rect.height);
    const scrollTop = progress * this.maxTimelineScroll;
    const closestMetric = this.timelineMetrics.reduce((closest, candidate) =>
      Math.abs(candidate.targetScrollTop - scrollTop) < Math.abs(closest.targetScrollTop - scrollTop) ? candidate : closest
    );

    return {
      topPercent: toTimelinePercent(progress),
      scrollTop,
      label: formatTimelineCurrentLabel(closestMetric.key)
    };
  }
}

function containsFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function shouldAnimateGalleryRegroup(previousItems: MediaRead[], nextItems: MediaRead[], hasRenderedItems: boolean): boolean {
  if (!hasRenderedItems || previousItems.length === 0 || nextItems.length === 0) {
    return false;
  }

  if (previousItems.length !== nextItems.length) {
    return true;
  }

  for (let index = 0; index < previousItems.length; index += 1) {
    const previous = previousItems[index];
    const next = nextItems[index];
    if (!previous || !next) {
      return true;
    }

    if (previous.id !== next.id || previous.metadata.captured_at !== next.metadata.captured_at) {
      return true;
    }
  }

  return false;
}

function buildGalleryDayGroups(items: MediaRead[]): GalleryDayGroup[] {
  const groups = new Map<string, GalleryDayGroup>();

  for (const item of items) {
    const key = getLocalDayKey(item.metadata.captured_at);
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(key, {
      key,
      label: formatGroupLabel(item.metadata.captured_at),
      items: [item]
    });
  }

  return Array.from(groups.values());
}

function isSelectAllShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a';
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function getLocalDayKey(value: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  const day = parts.find((part) => part.type === 'day')?.value ?? '00';

  return `${year}-${month}-${day}`;
}

function formatGroupLabel(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  };

  if (date.getFullYear() !== now.getFullYear()) {
    options.year = 'numeric';
  }

  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function formatTimelineMarkerLabel(groupKey: string): string {
  const [year, month, day] = groupKey.split('-').map((part) => Number(part));
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date(year, (month || 1) - 1, day || 1));
}

function formatTimelineCurrentLabel(groupKey: string): string {
  const [year, month] = groupKey.split('-').map((part) => Number(part));
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    year: 'numeric'
  }).format(new Date(year, (month || 1) - 1, 1));
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function getTimelineScrollOffset(): number {
  return 24;
}

function getGroupScrollTopAdjustment(section: HTMLElement): number {
  const header = section.querySelector('.gallery-group-header') as HTMLElement | null;
  return header ? Math.max(0, header.offsetTop) : 0;
}

function toTimelinePercent(progress: number): number {
  const boundedProgress = clampPercent(progress * 100) / 100;
  const safeRange = 100 - (TIMELINE_EDGE_PERCENT * 2);
  return clampPercent(TIMELINE_EDGE_PERCENT + (boundedProgress * safeRange));
}
