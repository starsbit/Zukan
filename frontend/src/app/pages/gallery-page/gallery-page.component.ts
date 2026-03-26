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
  ViewChild,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';

import { MediaRead } from '../../models/api';
import { AlbumPickerDialogComponent } from '../../components/album-picker-dialog/album-picker-dialog.component';
import { AppSidebarComponent } from '../../components/app-sidebar/app-sidebar.component';
import { MediaGroupedListComponent } from '../../components/media-grouped-list/media-grouped-list.component';
import { MediaNavbarComponent } from '../../components/media-search/media-navbar.component';
import { MediaSearchState } from '../../components/media-search/media-search.models';
import { buildMediaListQuery, createDefaultMediaSearchFilters } from '../../components/media-search/media-search.utils';
import { AlbumsService } from '../../services/albums.service';
import { MediaService } from '../../services/media.service';
import { MediaViewerComponent } from '../../components/media-viewer/media-viewer.component';
import { GalleryUploadStatusIslandComponent } from '../../components/gallery-upload-status-island/gallery-upload-status-island.component';
import { SelectionToolbarComponent } from '../../components/selection-toolbar/selection-toolbar.component';
import { UploadReviewDialogComponent, type UploadReviewDialogResult } from '../../components/upload-review-dialog/upload-review-dialog.component';
import { ListStateComponent } from '../../components/list-state/list-state.component';
import { MediaUploadService, type UploadReviewCandidate } from '../../services/media-upload.service';
import { isEditableTarget, isSelectAllShortcut } from '../../utils/dom-event.utils';
import { createResponsiveDialogConfig } from '../../utils/dialog-config.utils';
import { buildGalleryDayGroups, GalleryDayGroup, shouldAnimateGalleryRegroup } from '../../utils/gallery-grouping.utils';
import { isMediaSelected, selectMediaGroup, toggleMediaSelection, clearMediaSelection } from '../../utils/media-selection.utils';
import {
  clampUnit,
  formatTimelineCurrentLabel,
  formatTimelineMarkerLabel,
  getGroupScrollTopAdjustment,
  getTimelineScrollOffset,
  toTimelinePercent
} from '../../utils/timeline.utils';

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

const TIMELINE_LABEL_HIDE_DELAY_MS = 1400;
const REGROUP_ANIMATION_MS = 280;
const LOAD_MORE_THRESHOLD_PX = 640;

@Component({
  selector: 'app-gallery-page',
  imports: [
    AsyncPipe,
    MatButtonModule,
    MatIconModule,
    AppSidebarComponent,
    MediaGroupedListComponent,
    MediaNavbarComponent,
    MediaViewerComponent,
    GalleryUploadStatusIslandComponent,
    ListStateComponent,
    SelectionToolbarComponent
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
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly mediaService = inject(MediaService);
  private readonly albumsService = inject(AlbumsService);
  private readonly mediaUploadService = inject(MediaUploadService);

  @ViewChild('uploadInput') private uploadInput?: ElementRef<HTMLInputElement>;
  @ViewChild('galleryScroller') private galleryScroller?: ElementRef<HTMLElement>;
  @ViewChild('timelineTrack') private timelineTrack?: ElementRef<HTMLElement>;

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
  private pendingUploadReviews: UploadReviewCandidate[] = [];
  private reviewDialogOpen = false;
  searchState: MediaSearchState = {
    searchText: '',
    filters: createDefaultMediaSearchFilters()
  };
  private activeQuery = buildMediaListQuery(this.searchState.searchText, this.searchState.filters);

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

    this.mediaUploadService.reviewRequested$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((candidates) => {
        if (candidates.length === 0) {
          return;
        }

        this.pendingUploadReviews.push(...candidates);
        this.processNextUploadReview();
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
    this.scheduleTimelineRefresh();
  }

  reload(): void {
    this.loadMedia(this.activeQuery);
  }

  applySearch(searchState: MediaSearchState): void {
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

  updateSelectedMedia(media: MediaRead): void {
    if (this.selectedMedia?.id === media.id) {
      this.selectedMedia = media;
    }
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
    this.tryLoadNextPage();
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
    this.selectedMediaIds = toggleMediaSelection(this.selectedMediaIds, media);

    if (this.selectionMode) {
      this.selectedMedia = null;
    }
  }

  selectGroup(group: GalleryDayGroup): void {
    this.selectedMediaIds = selectMediaGroup(this.selectedMediaIds, group);
    this.selectedMedia = null;
  }

  clearSelection(): void {
    this.selectedMediaIds = clearMediaSelection();
  }

  isSelected(mediaId: string): boolean {
    return isMediaSelected(this.selectedMediaIds, mediaId);
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

  addSelectedToAlbum(): void {
    if (this.selectedMediaIds.size === 0) {
      return;
    }

    const openPicker = () => {
      this.dialog.open(AlbumPickerDialogComponent, createResponsiveDialogConfig({
        data: {
          albums: this.albumsService.snapshot.albums,
          selectedCount: this.selectedMediaIds.size
        }
      }, '420px')).afterClosed()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((albumId: string | undefined) => {
          if (!albumId) {
            return;
          }

          this.albumsService.addMedia(albumId, { media_ids: Array.from(this.selectedMediaIds) })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (result) => {
                this.clearSelection();
                this.snackBar.open(
                  result.skipped > 0
                    ? `Added ${result.processed} items. ${result.skipped} were already there.`
                    : `Added ${result.processed} items to the album.`,
                  'Close',
                  { duration: 3000 }
                );
              },
              error: () => {
                this.snackBar.open('Could not add images to the album. Please try again.', 'Close', { duration: 3000 });
              }
            });
        });
    };

    if (this.albumsService.snapshot.albums.length > 0) {
      openPicker();
      return;
    }

    this.albumsService.loadAlbums()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => openPicker(),
        error: () => {
          this.snackBar.open('Could not load albums. Please try again.', 'Close', { duration: 3000 });
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

  private processNextUploadReview(): void {
    if (this.reviewDialogOpen || this.pendingUploadReviews.length === 0) {
      return;
    }

    const candidate = this.pendingUploadReviews.shift();
    if (!candidate) {
      return;
    }

    this.reviewDialogOpen = true;
    const dialogRef = this.dialog.open(UploadReviewDialogComponent, {
      data: candidate,
      width: 'min(92vw, 720px)',
      maxWidth: '720px',
      disableClose: true,
      autoFocus: false
    });

    dialogRef.afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result: UploadReviewDialogResult | undefined) => {
        this.reviewDialogOpen = false;

        if (!result || result.action === 'skip') {
          this.processNextUploadReview();
          return;
        }

        if (result.action === 'skip_all') {
          this.pendingUploadReviews = [];
          return;
        }

        this.mediaService.updateMedia(candidate.media.id, {
          entities: result.characterName ? [{ entity_type: 'character' as const, name: result.characterName }] : [],
          tags: result.tags ?? []
        })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (media) => {
              if (this.selectedMedia?.id === media.id) {
                this.selectedMedia = media;
              }
              this.processNextUploadReview();
            },
            error: () => {
              this.processNextUploadReview();
            }
          });
      });
  }

  private loadMedia(query = this.activeQuery): void {
    this.mediaService.loadSearchPage(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }

  private tryLoadNextPage(): void {
    const scroller = this.galleryScroller?.nativeElement;
    if (!scroller) {
      return;
    }

    const remaining = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight);
    if (remaining > LOAD_MORE_THRESHOLD_PX) {
      return;
    }

    this.mediaService.loadNextPage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  private buildQueryForCurrentView() {
    const query = buildMediaListQuery(this.searchState.searchText, this.searchState.filters);

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
    const sections = this.getGroupElements();
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
    const metrics: GalleryTimelineMetric[] = sections.map((element, index) => {
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
    const sections = this.getGroupElements();
    return sections.find((section) => section.dataset['galleryGroupKey'] === groupKey) ?? null;
  }

  private getGroupElements(): HTMLElement[] {
    const scroller = this.galleryScroller?.nativeElement;
    if (!scroller) {
      return [];
    }

    return Array.from(scroller.querySelectorAll<HTMLElement>('[data-gallery-group-key]'));
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
