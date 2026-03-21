import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
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
export class GalleryPageComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private readonly route = inject(ActivatedRoute);
  private readonly mediaService = inject(MediaService);
  private readonly mediaUploadService = inject(MediaUploadService);

  @ViewChild('uploadInput') private uploadInput?: ElementRef<HTMLInputElement>;
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
  private currentItems: MediaRead[] = [];
  groupedItems: GalleryDayGroup[] = [];
  private dragDepth = 0;
  private timelineRefreshQueued = false;
  searchState: GallerySearchState = {
    searchText: '',
    filters: createDefaultGallerySearchFilters()
  };
  private activeQuery = buildGalleryListQuery(this.searchState.searchText, this.searchState.filters);

  constructor() {
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
        this.currentItems = items;
        this.groupedItems = buildGalleryDayGroups(items);
        this.scheduleTimelineRefresh();
      });
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

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.scheduleTimelineRefresh();
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

  scrollToGroup(groupKey: string): void {
    const section = this.findGroupElement(groupKey);
    if (!section) {
      return;
    }

    section.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
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
    if (sections.length === 0 || this.groupedItems.length === 0 || typeof window === 'undefined') {
      this.timelineMarkers = [];
      this.timelineYears = [];
      this.activeTimelineKey = null;
      this.activeTimelineYear = null;
      this.activeTimelineLabel = '';
      this.activeTimelineTopPercent = 0;
      this.cdr.markForCheck();
      return;
    }

    const metrics = sections.map((sectionRef, index) => {
      const element = sectionRef.nativeElement;
      const header = element.querySelector('.gallery-group-header') as HTMLElement | null;
      const anchor = header ?? element;
      const rect = anchor.getBoundingClientRect();

      return {
        key: this.groupedItems[index]?.key ?? '',
        center: rect.top + window.scrollY + (rect.height / 2)
      };
    }).filter((metric) => metric.key.length > 0);

    if (metrics.length === 0) {
      return;
    }

    const firstCenter = metrics[0].center;
    const lastCenter = metrics[metrics.length - 1].center;
    const range = Math.max(lastCenter - firstCenter, 1);

    this.timelineMarkers = metrics.map((metric) => ({
      key: metric.key,
      ariaLabel: formatTimelineMarkerLabel(metric.key),
      year: metric.key.slice(0, 4),
      topPercent: clampPercent(((metric.center - firstCenter) / range) * 100)
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

    const viewportCenter = window.scrollY + (window.innerHeight / 2);
    const activeMetric = metrics.reduce((closest, candidate) =>
      Math.abs(candidate.center - viewportCenter) < Math.abs(closest.center - viewportCenter) ? candidate : closest
    );

    this.activeTimelineKey = activeMetric.key;
    this.activeTimelineYear = activeMetric.key.slice(0, 4);
    this.activeTimelineLabel = formatTimelineCurrentLabel(activeMetric.key);
    this.activeTimelineTopPercent = clampPercent(((activeMetric.center - firstCenter) / range) * 100);
    this.cdr.markForCheck();
  }

  private findGroupElement(groupKey: string): HTMLElement | null {
    const sections = this.groupSections?.toArray() ?? [];
    const index = this.groupedItems.findIndex((group) => group.key === groupKey);
    return index >= 0 ? sections[index]?.nativeElement ?? null : null;
  }
}

function containsFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
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
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date(value));
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
