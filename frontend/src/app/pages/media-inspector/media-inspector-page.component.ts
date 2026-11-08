import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, NavigationStart, Router } from '@angular/router';
import { catchError, EMPTY, of, Subscription } from 'rxjs';
import { MediaInspectorDialogComponent } from '../../components/media-browser/media-inspector-dialog/media-inspector-dialog.component';
import { SimilarMediaGridComponent } from '../../components/media-browser/similar-media-grid/similar-media-grid.component';
import { MetadataFilterSelection } from '../../components/shared/metadata-filter-chip/metadata-filter-chip.component';
import { MediaDetail, MediaRead, RelatedMediaRead } from '../../models/media';
import { DetailEntry, DetailEntryStore } from '../../services/detail-entry.store';
import { GalleryStore } from '../../services/gallery.store';
import { MediaNavigator } from '../../services/media-navigator.service';
import { MediaService } from '../../services/media.service';
import { NavbarSearchService } from '../../services/navbar-search.service';

const SIMILAR_LOAD_MARGIN_PX = 800;

@Component({
  selector: 'zukan-media-inspector-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MediaInspectorDialogComponent,
    SimilarMediaGridComponent,
  ],
  templateUrl: './media-inspector-page.component.html',
  styleUrl: './media-inspector-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaInspectorPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly mediaService = inject(MediaService);
  private readonly galleryStore = inject(GalleryStore);
  private readonly navigator = inject(MediaNavigator);
  private readonly detailEntries = inject(DetailEntryStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly searchService = inject(NavbarSearchService);

  private readonly knownItems = signal<ReadonlyMap<string, MediaRead>>(new Map());
  private readonly opensFromFeed = signal(false);
  private fetchingMediaId: string | null = null;
  private entryKey: string | null = null;
  private similarRequest?: Subscription;
  private resizeObserver?: ResizeObserver;

  readonly activeMediaId = signal<string | null>(null);
  readonly prefetchedDetail = signal<MediaDetail | null>(null);
  readonly showSimilar = signal(false);
  readonly similarEntry = signal<DetailEntry | null>(null);
  readonly similarLoading = signal(false);
  readonly containerWidth = signal(
    typeof document === 'undefined' ? 0 : document.documentElement.clientWidth,
  );
  readonly error = signal('');
  readonly items = computed<MediaRead[]>(() => {
    const mediaId = this.activeMediaId();
    if (!mediaId) {
      return [];
    }

    if (this.opensFromFeed()) {
      const feed = this.galleryStore.groupedByDay().flatMap((group) => group.items);
      if (feed.some((item) => item.id === mediaId)) {
        return feed;
      }
    }

    const known = this.knownItems().get(mediaId);
    return known ? [known] : [];
  });
  readonly loading = computed(() => !this.error() && this.items().length === 0);

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const mediaId = params.get('mediaId');
      this.error.set(mediaId ? '' : 'Media not found.');
      this.opensFromFeed.set(this.navigator.feedPath() !== null && this.navigator.depth() <= 1);
      this.prefetchedDetail.set(null);
      this.activeMediaId.set(mediaId);
      this.navigator.lastViewedId.set(mediaId);
      this.showSimilar.set(this.navigator.feedPath() !== '/trash');
      this.enterDetailEntry(mediaId);
    });

    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.saveScrollPosition();
      }
    });

    afterNextRender(() => this.observeWidth());
    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.similarRequest?.unsubscribe();
    });

    effect(() => {
      const mediaId = this.activeMediaId();
      if (mediaId && this.items().length === 0) {
        untracked(() => this.fetchMedia(mediaId));
      }
    });

    effect(() => {
      const mediaId = this.activeMediaId();
      if (mediaId && this.opensFromFeed() && this.items().length > 1) {
        untracked(() => this.loadFeedAround(mediaId));
      }
    });
  }

  onActiveMediaChanged(mediaId: string): void {
    this.navigator.step(mediaId);
  }

  onRelatedPostSelected(media: MediaRead): void {
    this.rememberItem(media);
    this.navigator.openRelated(media.id);
  }

  onSimilarFavoriteToggled(media: RelatedMediaRead): void {
    this.galleryStore
      .toggleFavorite(media)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of(media)),
      )
      .subscribe((updated) => {
        this.updateSimilarEntry((entry) => ({
          ...entry,
          similarItems: entry.similarItems.map((item) =>
            item.id === media.id ? { ...item, ...updated } : item,
          ),
        }));
      });
  }

  close(): void {
    this.navigator.close();
  }

  @HostListener('scroll')
  onScroll(): void {
    if (this.isNearSimilarEnd()) {
      this.loadSimilar();
    }
  }

  private isNearSimilarEnd(): boolean {
    const { scrollTop, clientHeight, scrollHeight } = this.host.nativeElement;
    return scrollTop + clientHeight >= scrollHeight - SIMILAR_LOAD_MARGIN_PX;
  }

  onMediaUpdated(media: MediaRead): void {
    this.rememberItem(media);
    this.galleryStore.patchExisting(media);
  }

  onMetadataFilterSelected(selection: MetadataFilterSelection): void {
    this.searchService.suppressNextUrlSync();
    this.searchService.addMetadataFilter(selection.type, selection.value);

    void this.router.navigate([this.navigator.feedPath() ?? '/gallery'], {
      queryParams: compactQueryParams(this.searchService.toQueryParamsWithClears()),
    });
  }

  private enterDetailEntry(mediaId: string | null): void {
    this.similarRequest?.unsubscribe();
    this.similarLoading.set(false);
    if (!mediaId) {
      this.entryKey = null;
      this.similarEntry.set(null);
      return;
    }

    this.entryKey = this.navigator.entryKey() ?? `direct:${mediaId}`;
    const cached = this.detailEntries.get(this.entryKey);
    if (cached?.mediaId === mediaId) {
      this.similarEntry.set(cached);
      afterNextRender(
        () => {
          this.host.nativeElement.scrollTop = cached.scrollTop;
        },
        { injector: this.injector },
      );
      if (!cached.loaded) {
        this.loadSimilar();
      }
      return;
    }

    const entry: DetailEntry = {
      mediaId,
      similarItems: [],
      cursor: null,
      hasMore: false,
      loaded: false,
      scrollTop: 0,
    };
    this.detailEntries.set(this.entryKey, entry);
    this.similarEntry.set(entry);
    this.host.nativeElement.scrollTop = 0;
    this.loadSimilar();
  }

  private loadSimilar(): void {
    const entry = this.similarEntry();
    const key = this.entryKey;
    if (
      !entry ||
      !key ||
      !this.showSimilar() ||
      this.similarLoading() ||
      (entry.loaded && !entry.hasMore)
    ) {
      return;
    }

    this.similarLoading.set(true);
    this.similarRequest = this.mediaService
      .getSimilar(entry.mediaId, entry.cursor)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of({ items: [], next_cursor: null, has_more: false, page_size: 0 })),
      )
      .subscribe((page) => {
        this.similarLoading.set(false);
        this.updateSimilarEntry((current) => ({
          ...current,
          similarItems: [...current.similarItems, ...page.items],
          cursor: page.next_cursor,
          hasMore: page.has_more,
          loaded: true,
        }));
        if (page.has_more && entry.cursor !== null) {
          afterNextRender(
            () => {
              if (this.similarEntry()?.mediaId === entry.mediaId && this.isNearSimilarEnd()) {
                this.loadSimilar();
              }
            },
            { injector: this.injector },
          );
        }
      });
  }

  private updateSimilarEntry(update: (entry: DetailEntry) => DetailEntry): void {
    const entry = this.similarEntry();
    if (!entry || !this.entryKey) {
      return;
    }

    const next = update(entry);
    this.detailEntries.set(this.entryKey, next);
    this.similarEntry.set(next);
  }

  private saveScrollPosition(): void {
    const scrollTop = this.host.nativeElement.scrollTop;
    this.updateSimilarEntry((entry) => ({ ...entry, scrollTop }));
  }

  private observeWidth(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) {
        this.containerWidth.set(entry.contentRect.width);
      }
    });
    this.resizeObserver.observe(this.host.nativeElement);
  }

  private fetchMedia(mediaId: string): void {
    if (this.fetchingMediaId === mediaId) {
      return;
    }

    this.fetchingMediaId = mediaId;
    this.mediaService
      .get(mediaId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => {
          this.fetchingMediaId = null;
          if (this.activeMediaId() === mediaId) {
            this.error.set('Unable to load this media.');
          }
          return EMPTY;
        }),
      )
      .subscribe((media) => {
        this.fetchingMediaId = null;
        if (this.activeMediaId() === mediaId) {
          this.prefetchedDetail.set(media);
        }
        this.rememberItem(media);
      });
  }

  private loadFeedAround(mediaId: string): void {
    this.galleryStore
      .loadAroundItem(mediaId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => EMPTY),
      )
      .subscribe();
  }

  private rememberItem(media: MediaRead): void {
    this.knownItems.update((items) => new Map(items).set(media.id, media));
  }
}

function compactQueryParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== null && value !== undefined),
  );
}
