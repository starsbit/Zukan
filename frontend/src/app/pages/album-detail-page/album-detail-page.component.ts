import { AsyncPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  ViewChild,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map, switchMap } from 'rxjs';

import { MediaRead } from '../../models/api';
import { AlbumFormDialogComponent, AlbumFormDialogValue } from '../../components/album-form-dialog/album-form-dialog.component';
import { AppSidebarComponent } from '../../components/app-sidebar/app-sidebar.component';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { MediaGroupedListComponent } from '../../components/media-grouped-list/media-grouped-list.component';
import { MediaNavbarComponent } from '../../components/media-search/media-navbar.component';
import { MediaSearchState } from '../../components/media-search/media-search.models';
import { buildMediaListQuery, createDefaultMediaSearchFilters } from '../../components/media-search/media-search.utils';
import { MediaViewerComponent } from '../../components/media-viewer/media-viewer.component';
import { ListStateComponent } from '../../components/list-state/list-state.component';
import { SelectionToolbarComponent } from '../../components/selection-toolbar/selection-toolbar.component';
import { AlbumsService } from '../../services/albums.service';
import { MediaService } from '../../services/media.service';
import { createResponsiveDialogConfig } from '../../utils/dialog-config.utils';
import { isEditableTarget } from '../../utils/dom-event.utils';
import { buildGalleryDayGroups, GalleryDayGroup } from '../../utils/gallery-grouping.utils';
import { isMediaSelected, selectMediaGroup, toggleMediaSelection, clearMediaSelection } from '../../utils/media-selection.utils';
import {
  clampUnit,
  formatTimelineCurrentLabel,
  formatTimelineMarkerLabel,
  getGroupScrollTopAdjustment,
  getTimelineScrollOffset,
  toTimelinePercent
} from '../../utils/timeline.utils';

const LOAD_MORE_THRESHOLD_PX = 640;
const TIMELINE_LABEL_HIDE_DELAY_MS = 1400;

interface AlbumTimelineMarker {
  key: string;
  ariaLabel: string;
  year: string;
  topPercent: number;
}

interface AlbumTimelineYear {
  year: string;
  topPercent: number;
}

interface AlbumTimelineMetric {
  key: string;
  center: number;
  targetScrollTop: number;
}

@Component({
  selector: 'app-album-detail-page',
  imports: [
    AsyncPipe,
    MatButtonModule,
    MatIconModule,
    RouterLink,
    AppSidebarComponent,
    MediaGroupedListComponent,
    MediaNavbarComponent,
    MediaViewerComponent,
    ListStateComponent,
    SelectionToolbarComponent
  ],
  templateUrl: './album-detail-page.component.html',
  styleUrl: './album-detail-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AlbumDetailPageComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly albumsService = inject(AlbumsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mediaService = inject(MediaService);
  private readonly ngZone = inject(NgZone);

  @ViewChild('albumScroller') private albumScroller?: ElementRef<HTMLElement>;
  @ViewChild('timelineTrack') private timelineTrack?: ElementRef<HTMLElement>;

  readonly album$ = this.albumsService.selectedAlbum$;
  readonly media$ = this.mediaService.items$;
  readonly loading$ = this.mediaService.loading$;
  readonly error$ = this.mediaService.error$;

  selectedMedia: MediaRead | null = null;
  selectedMediaIds = new Set<string>();
  groupedItems: GalleryDayGroup[] = [];
  timelineMarkers: AlbumTimelineMarker[] = [];
  timelineYears: AlbumTimelineYear[] = [];
  activeTimelineKey: string | null = null;
  activeTimelineYear: string | null = null;
  activeTimelineLabel = '';
  activeTimelineTopPercent = 0;
  timelineCurrentLabelVisible = false;
  hoverTimelineLabel = '';
  hoverTimelineTopPercent: number | null = null;
  searchState: MediaSearchState = {
    searchText: '',
    filters: createDefaultMediaSearchFilters()
  };
  private albumId = '';
  private timelineDragging = false;
  private timelineMetrics: AlbumTimelineMetric[] = [];
  private maxTimelineScroll = 1;
  private timelineRefreshQueued = false;
  private timelineLabelHideTimeoutId: number | null = null;

  constructor() {
    this.route.paramMap
      .pipe(
        map((params) => params.get('albumId') ?? ''),
        switchMap((albumId) => {
          this.albumId = albumId;
          this.selectedMedia = null;
          this.clearSelection();
          this.searchState = {
            searchText: '',
            filters: createDefaultMediaSearchFilters()
          };
          return this.albumsService.loadAlbum(albumId);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (album) => {
          this.loadMedia();
        },
        error: () => undefined
      });

    this.media$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => {
        this.groupedItems = buildGalleryDayGroups(items);
        this.scheduleTimelineRefresh();
      });
  }

  ngAfterViewInit(): void {
    this.scheduleTimelineRefresh();
  }

  ngOnDestroy(): void {
    this.timelineDragging = false;
    this.clearTimelineLabelHideTimeout();
  }

  reload(): void {
    if (!this.albumId) {
      return;
    }

    this.albumsService.loadAlbum(this.albumId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadMedia();
        },
        error: () => undefined
      });
  }

  applySearch(searchState: MediaSearchState): void {
    this.searchState = {
      searchText: searchState.searchText,
      filters: {
        ...searchState.filters,
        album_id: null
      }
    };
    this.loadMedia();
  }

  renameAlbum(currentName: string, currentDescription: string | null): void {
    this.dialog.open(AlbumFormDialogComponent, createResponsiveDialogConfig({
      data: {
        title: 'Edit album',
        confirmLabel: 'Save',
        initialName: currentName,
        initialDescription: currentDescription
      }
    }, '420px')).afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value: AlbumFormDialogValue | undefined) => {
        if (!value || !this.albumId) {
          return;
        }

        if (value.name === currentName && value.description === (currentDescription ?? null)) {
          return;
        }

        this.albumsService.updateAlbum(this.albumId, value)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.snackBar.open('Album renamed.', 'Close', { duration: 2500 });
            },
            error: () => {
              this.snackBar.open('Could not rename album. Please try again.', 'Close', { duration: 3000 });
            }
          });
      });
  }

  deleteAlbum(name: string): void {
    if (!this.albumId) {
      return;
    }

    this.dialog.open(ConfirmDialogComponent, createResponsiveDialogConfig({
      data: {
        title: 'Delete album',
        message: `Delete "${name}"? This will remove the album, but it will not delete the images inside it.`,
        confirmLabel: 'Delete',
        confirmButtonColor: 'warn'
      }
    }, '400px')).afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed: boolean | undefined) => {
        if (!confirmed) {
          return;
        }

        this.albumsService.deleteAlbum(this.albumId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.snackBar.open('Album deleted.', 'Close', { duration: 2500 });
              void this.router.navigate(['/albums']);
            },
            error: () => {
              this.snackBar.open('Could not delete album. Please try again.', 'Close', { duration: 3000 });
            }
          });
      });
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

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || this.selectedMedia !== null || isEditableTarget(event.target)) {
      return;
    }

    event.preventDefault();

    if (this.selectionMode) {
      this.clearSelection();
      return;
    }

    void this.router.navigate(['/albums']);
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.albumScroller) {
      return;
    }

    const root = document.documentElement;
    const remaining = root.scrollHeight - (window.scrollY + window.innerHeight);
    if (remaining > LOAD_MORE_THRESHOLD_PX) {
      return;
    }

    this.mediaService.loadNextPage().subscribe({ error: () => undefined });
  }

  onAlbumScroll(): void {
    this.tryLoadNextPage();
    this.showTimelineCurrentLabelTemporarily();
    this.scheduleTimelineRefresh();
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

  clearSelection(): void {
    this.selectedMediaIds = clearMediaSelection();
  }

  selectGroup(group: GalleryDayGroup): void {
    this.selectedMediaIds = selectMediaGroup(this.selectedMediaIds, group);
    this.selectedMedia = null;
  }

  removeSelectedFromAlbum(): void {
    if (!this.albumId || this.selectedMediaIds.size === 0) {
      return;
    }

    const mediaIds = Array.from(this.selectedMediaIds);
    this.selectedMedia = null;

    this.albumsService.removeMedia(this.albumId, { media_ids: mediaIds })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.clearSelection();
          this.reload();
          this.snackBar.open('Removed selected images from the album.', 'Close', { duration: 2500 });
        },
        error: () => {
          this.snackBar.open('Could not remove the selected images. Please try again.', 'Close', { duration: 3000 });
        }
      });
  }

  isSelected(mediaId: string): boolean {
    return isMediaSelected(this.selectedMediaIds, mediaId);
  }

  scrollToGroup(groupKey: string): void {
    const section = this.findGroupElement(groupKey);
    const scroller = this.albumScroller?.nativeElement;
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

  get selectionMode(): boolean {
    return this.selectedMediaIds.size > 0;
  }

  get selectedCount(): number {
    return this.selectedMediaIds.size;
  }

  private loadMedia(): void {
    if (!this.albumId) {
      return;
    }

    const query = {
      ...buildMediaListQuery(this.searchState.searchText, this.searchState.filters),
      album_id: this.albumId,
      page_size: 120
    };
    this.mediaService.loadSearchPage(query).subscribe({ error: () => undefined });
  }

  private tryLoadNextPage(): void {
    const scroller = this.albumScroller?.nativeElement;
    if (!scroller) {
      this.onWindowScroll();
      return;
    }

    const remaining = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight);
    if (remaining > LOAD_MORE_THRESHOLD_PX) {
      return;
    }

    this.mediaService.loadNextPage().subscribe({ error: () => undefined });
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
    const scroller = this.albumScroller?.nativeElement;
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
    const metrics: AlbumTimelineMetric[] = sections.map((element, index) => {
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

    const maxScroll = Math.max(scroller.scrollHeight - scroller.clientHeight, 1);
    const currentScroll = Math.max(0, Math.min(scroller.scrollTop, maxScroll));
    this.timelineMetrics = metrics;
    this.maxTimelineScroll = maxScroll;

    this.timelineMarkers = metrics.map((metric) => ({
      key: metric.key,
      ariaLabel: formatTimelineMarkerLabel(metric.key),
      year: metric.key.slice(0, 4),
      topPercent: toTimelinePercent(metric.targetScrollTop / maxScroll)
    }));

    const years = new Map<string, AlbumTimelineYear>();
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
    const scroller = this.albumScroller?.nativeElement;
    if (!scroller) {
      return [];
    }

    return Array.from(scroller.querySelectorAll<HTMLElement>('[data-gallery-group-key]'));
  }

  private scrubTimelineToClientY(clientY: number): void {
    const target = this.getTimelinePointerTarget(clientY);
    const scroller = this.albumScroller?.nativeElement;
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
