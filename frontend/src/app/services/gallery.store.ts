import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, concatMap, EMPTY, expand, forkJoin, from, map, Observable, of, reduce, switchMap, tap, throwError } from 'rxjs';
import { MediaClientService, MediaSearchParams } from './web/media-client.service';
import { groupByDay, groupTimelineByYear } from '../utils/gallery-grouping.utils';
import {
  MediaCursorPage,
  MediaAnnotationBatchUpdate,
  MediaRead,
  MediaType,
  MediaVisibility,
  ProcessingStatus,
  TaggingStatus,
} from '../models/media';
import { MediaTimeline, TimelineBucket } from '../models/timeline';

const GIF_EXTENSIONS = new Set(['.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);

export interface GalleryMonthState {
  key: string;
  year: number;
  month: number;
  items: MediaRead[];
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  estimatedCount: number;
}

@Injectable({ providedIn: 'root' })
export class GalleryStore {
  static readonly PAGE_SIZE = 1000;
  static readonly MONTH_PAGE_SIZE = 160;
  static readonly BULK_MUTATION_CHUNK_SIZE = 500;
  private readonly client = inject(MediaClientService);

  private readonly _params = signal<MediaSearchParams>({});
  private readonly _months = signal<Map<string, GalleryMonthState>>(new Map());
  private readonly _optimisticItems = signal<MediaRead[]>([]);
  private readonly _total = signal<number | null>(null);
  private readonly _loading = signal(false);
  private readonly _timeline = signal<TimelineBucket[]>([]);
  private readonly _timelineLoading = signal(false);

  readonly params = this._params.asReadonly();
  readonly months = computed(() => Array.from(this._months().values()));
  readonly monthMap = this._months.asReadonly();
  readonly items = computed(() => {
    const optimistic = this._optimisticItems();
    const loadedItems = this.loadedItems();
    if (optimistic.length === 0) {
      return this.sortItems(loadedItems);
    }

    const optimisticById = new Map(optimistic.map((item) => [item.id, item]));
    const serverItems = loadedItems.map((item) => {
      const optimisticMatch = optimisticById.get(item.id);
      if (!optimisticMatch || !this.isStillProcessing(item) || !optimisticMatch.client_preview_url) {
        return item;
      }

      return {
        ...item,
        client_preview_url: optimisticMatch.client_preview_url,
        client_is_optimistic: true,
        client_batch_id: optimisticMatch.client_batch_id,
        client_source_filename: optimisticMatch.client_source_filename,
      };
    });
    const serverIds = new Set(serverItems.map((item) => item.id));
    const unresolvedOptimistic = optimistic.filter((item) => !serverIds.has(item.id));

    return this.sortItems([
      ...unresolvedOptimistic,
      ...serverItems,
    ]);
  });
  readonly hasMore = computed(() => this.months().some((month) => month.hasMore));
  readonly total = computed(() => {
    const total = this._total();
    if (total == null) {
      return null;
    }

    const serverIds = new Set(this.loadedItems().map((item) => item.id));
    const unresolvedOptimisticCount = this._optimisticItems().filter((item) => !serverIds.has(item.id)).length;
    return total + unresolvedOptimisticCount;
  });
  readonly loading = this._loading.asReadonly();
  readonly timeline = this._timeline.asReadonly();
  readonly timelineLoading = this._timelineLoading.asReadonly();

  readonly groupedByDay = computed(() => groupByDay(this.items()));
  readonly timelineByYear = computed(() => groupTimelineByYear(this._timeline()));

  setParams(params: MediaSearchParams): void {
    this.resetForParams(params);
  }

  resetForParams(params: MediaSearchParams): void {
    this._params.set(params);
    this._months.set(new Map());
    this._total.set(null);
  }

  load(): Observable<MediaCursorPage> {
    this._loading.set(true);
    return this.client.search({ page_size: GalleryStore.MONTH_PAGE_SIZE, include_total: true, ...this._params() }).pipe(
      tap((page) => {
        this.replaceMonthsFromPage(page);
        this._total.set(page.total);
        this._loading.set(false);
      }),
      catchError((err) => {
        this._loading.set(false);
        return throwError(() => err);
      }),
    );
  }

  loadMore(): Observable<MediaCursorPage> {
    const month = this.months().find((candidate) => candidate.hasMore && !candidate.loading);
    return month ? this.loadMoreForMonth(month.key) : EMPTY;
  }

  loadInitial(): Observable<{ timeline: MediaTimeline; page: MediaCursorPage | null }> {
    this._loading.set(true);
    return this.loadTimeline().pipe(
      switchMap((timeline) => {
        this._total.set(timeline.buckets.reduce((sum, bucket) => sum + bucket.count, 0));
        const firstBucket = timeline.buckets[0];
        if (!firstBucket) {
          this._loading.set(false);
          return of({ timeline, page: null });
        }

        return this.loadMonth(firstBucket.year, firstBucket.month).pipe(
          map((page) => ({ timeline, page })),
        );
      }),
      tap(() => this._loading.set(false)),
      catchError((err) => {
        this._loading.set(false);
        return throwError(() => err);
      }),
    );
  }

  loadTimeline(): Observable<MediaTimeline> {
    const { captured_year, captured_month, captured_day, captured_after, captured_before, captured_before_year, uploaded_year, uploaded_month, uploaded_day, uploaded_after, uploaded_before, uploaded_before_year, after, page_size, include_total, ...timelineParams } = this._params();
    this._timelineLoading.set(true);
    return this.client.getTimeline(timelineParams).pipe(
      tap((tl) => {
        this._timeline.set(tl.buckets);
        this._timelineLoading.set(false);
      }),
      catchError((err) => {
        this._timelineLoading.set(false);
        return throwError(() => err);
      }),
    );
  }

  ensureMonthWindow(monthKey: string): Observable<MediaCursorPage | null> {
    const bucket = this.bucketForMonthKey(monthKey);
    if (!bucket) {
      return of(null);
    }

    const current = this._months().get(monthKey);
    if (current?.loaded || current?.loading) {
      return of(null);
    }

    return this.loadMonth(bucket.year, bucket.month);
  }

  loadMonth(year: number, month: number): Observable<MediaCursorPage> {
    const key = this.monthKey(year, month);
    const existing = this._months().get(key);
    if (existing?.loading) {
      return EMPTY;
    }

    this.upsertMonthState(key, {
      year,
      month,
      loading: true,
      estimatedCount: this.bucketForMonthKey(key)?.count ?? existing?.estimatedCount ?? 0,
    });

    return this.client.search({
      ...this._params(),
      after: undefined,
      page_size: GalleryStore.MONTH_PAGE_SIZE,
      include_total: false,
      captured_year: year,
      captured_month: month,
    }).pipe(
      tap((page) => {
        this.upsertMonthState(key, {
          year,
          month,
          items: page.items,
          cursor: page.next_cursor,
          hasMore: page.has_more,
          loading: false,
          loaded: true,
          estimatedCount: this.bucketForMonthKey(key)?.count ?? page.items.length,
        });
      }),
      catchError((err) => {
        this.upsertMonthState(key, { year, month, loading: false });
        return throwError(() => err);
      }),
    );
  }

  loadMoreForMonth(monthKey: string): Observable<MediaCursorPage> {
    const current = this._months().get(monthKey);
    if (!current || current.loading || !current.hasMore || !current.cursor) {
      return EMPTY;
    }

    this.upsertMonthState(monthKey, { loading: true });
    return this.client.search({
      ...this._params(),
      after: current.cursor,
      page_size: GalleryStore.MONTH_PAGE_SIZE,
      include_total: false,
      captured_year: current.year,
      captured_month: current.month,
    }).pipe(
      tap((page) => {
        this.upsertMonthState(monthKey, {
          items: [...current.items, ...page.items],
          cursor: page.next_cursor,
          hasMore: page.has_more,
          loading: false,
          loaded: true,
        });
      }),
      catchError((err) => {
        this.upsertMonthState(monthKey, { loading: false });
        return throwError(() => err);
      }),
    );
  }

  patchItem(updated: MediaRead): void {
    this.dropOptimisticItems([updated.id]);
    const key = this.monthKeyForMedia(updated);
    this._months.update((months) => {
      const next = new Map(months);
      let matched = false;
      for (const [monthKey, month] of next) {
        if (!month.items.some((item) => item.id === updated.id)) {
          continue;
        }
        matched = true;
        next.set(monthKey, {
          ...month,
          items: month.items.map((item) => item.id === updated.id ? updated : item),
        });
      }
      if (!matched) {
        const current = next.get(key) ?? this.emptyMonthState(key);
        next.set(key, {
          ...current,
          loaded: true,
          items: [updated, ...current.items],
        });
      }
      return next;
    });
  }

  toggleFavorite(media: MediaRead): Observable<MediaRead> {
    const next = !media.is_favorited;
    const countDelta = next ? 1 : -1;
    const optimisticMedia = {
      ...media,
      is_favorited: next,
      favorite_count: Math.max(0, (media.favorite_count ?? 0) + countDelta),
    };

    this.patchItem(optimisticMedia);
    return this.client.batchUpdate({ media_ids: [media.id], favorited: next }).pipe(
      tap(() => {
        if (this.shouldRemoveAfterFavoriteToggle(next)) {
          this.removeItem(media.id);
          return;
        }

        this.patchItem(optimisticMedia);
      }),
      map(() => optimisticMedia),
      catchError((err) => {
        this.patchItem(media);
        return throwError(() => err);
      }),
    );
  }

  addAcceptedUploads(files: File[], visibility: MediaVisibility, batchId: string, mediaIds: Array<string | null>): void {
    const accepted = files
      .map((file, index) => this.buildOptimisticMedia(file, visibility, batchId, mediaIds[index] ?? null));

    this._optimisticItems.update((items) => {
      const existingIds = new Set(items.map((item) => item.id));
      return [
        ...accepted.filter((item) => !existingIds.has(item.id)),
        ...items,
      ];
    });
  }

  removeItem(id: string): void {
    this.dropOptimisticItems([id]);
    this.removeLoadedItems([id]);
    this._total.update((t) => t != null ? t - 1 : null);
  }

  removeItems(ids: string[]): void {
    this.dropOptimisticItems(ids);
    const set = new Set(ids);
    const before = this.loadedItems().length;
    this.removeLoadedItems(ids);
    const removed = before - this.loadedItems().length;
    this._total.update((t) => t != null ? t - removed : null);
  }

  batchDelete(ids: string[]): Observable<{ processed: number; skipped: number }> {
    return this.client.batchDelete({ media_ids: ids }).pipe(
      tap(() => this.removeItems(ids)),
      switchMap((result) =>
        this.refresh().pipe(
          map(() => result),
        ),
      ),
    );
  }

  batchUpdateVisibility(ids: string[], visibility: MediaVisibility): Observable<{ processed: number; skipped: number }> {
    if (ids.length === 0) {
      return of({ processed: 0, skipped: 0 });
    }

    return from(this.chunkIds(ids, GalleryStore.BULK_MUTATION_CHUNK_SIZE)).pipe(
      concatMap((chunk) => this.client.batchUpdate({ media_ids: chunk, visibility })),
      reduce(
        (acc, result) => ({
          processed: acc.processed + result.processed,
          skipped: acc.skipped + result.skipped,
        }),
        { processed: 0, skipped: 0 },
      ),
      switchMap((result) =>
        this.refresh().pipe(
          map(() => result),
        ),
      ),
    );
  }

  batchUpdateAnnotations(body: MediaAnnotationBatchUpdate): Observable<{ processed: number; skipped: number }> {
    if (body.media_ids.length === 0) {
      return of({ processed: 0, skipped: 0 });
    }

    return from(this.chunkIds(body.media_ids, GalleryStore.BULK_MUTATION_CHUNK_SIZE)).pipe(
      concatMap((chunk) => this.client.batchUpdateAnnotations({ ...body, media_ids: chunk })),
      reduce(
        (acc, result) => ({
          processed: acc.processed + result.processed,
          skipped: acc.skipped + result.skipped,
        }),
        { processed: 0, skipped: 0 },
      ),
      switchMap((result) =>
        this.refresh().pipe(
          map(() => result),
        ),
      ),
    );
  }

  batchQueueTaggingJobs(ids: string[]): Observable<{ queued: number }> {
    return this.client.batchQueueTaggingJobs({ media_ids: ids }).pipe(
      tap(() => {
        const set = new Set(ids);
        this.updateLoadedItems((item) => set.has(item.id)
          ? { ...item, tagging_status: TaggingStatus.PENDING, tagging_error: null }
          : item);
        this._optimisticItems.update((items) =>
          items.map((item) => set.has(item.id)
            ? { ...item, tagging_status: TaggingStatus.PENDING, tagging_error: null }
            : item),
        );
      }),
      switchMap((result) =>
        this.refresh().pipe(
          map(() => result),
        ),
      ),
    );
  }

  batchRestore(ids: string[]): Observable<{ processed: number; skipped: number }> {
    if (ids.length === 0) {
      return of({ processed: 0, skipped: 0 });
    }

    return from(this.chunkIds(ids)).pipe(
      concatMap((chunk) => this.client.batchUpdate({ media_ids: chunk, deleted: false })),
      reduce(
        (acc, result) => ({
          processed: acc.processed + result.processed,
          skipped: acc.skipped + result.skipped,
        }),
        { processed: 0, skipped: 0 },
      ),
      switchMap((result) =>
        this.refresh().pipe(
          map(() => result),
        ),
      ),
    );
  }

  restoreAllTrashed(): Observable<{ processed: number; skipped: number }> {
    return this.fetchAllMatchingIds().pipe(
      switchMap((ids) => this.batchRestore(ids)),
    );
  }

  emptyTrash(): Observable<void> {
    return this.client.emptyTrash().pipe(
      switchMap(() =>
        this.refresh().pipe(
          map(() => void 0),
        ),
      ),
    );
  }

  refresh(): Observable<{ page: MediaCursorPage; timeline: MediaTimeline }> {
    const activeKey = this.months().find((month) => month.loaded)?.key;
    return this.loadTimeline().pipe(
      switchMap((timeline) => {
        this._total.set(timeline.buckets.reduce((sum, bucket) => sum + bucket.count, 0));
        this._months.set(new Map());
        const target = activeKey && timeline.buckets.some((bucket) => this.monthKey(bucket.year, bucket.month) === activeKey)
          ? activeKey
          : timeline.buckets[0] ? this.monthKey(timeline.buckets[0].year, timeline.buckets[0].month) : null;
        if (!target) {
          return of({
            timeline,
            page: { items: [], total: 0, next_cursor: null, has_more: false, page_size: GalleryStore.MONTH_PAGE_SIZE },
          });
        }
        const bucket = this.bucketForMonthKey(target);
        return this.loadMonth(bucket!.year, bucket!.month).pipe(
          map((page) => ({ page, timeline })),
        );
      }),
    );
  }

  clearOptimisticItems(): void {
    this.revokeOptimisticItems(this._optimisticItems());
    this._optimisticItems.set([]);
  }

  reset(): void {
    this._params.set({});
    this._months.set(new Map());
    this.clearOptimisticItems();
    this._total.set(null);
    this._loading.set(false);
    this._timeline.set([]);
    this._timelineLoading.set(false);
  }

  private buildOptimisticMedia(
    file: File,
    visibility: MediaVisibility,
    batchId: string,
    mediaId: string | null,
  ): MediaRead {
    const mediaType = this.mediaTypeFromFile(file);

    return {
      id: mediaId ?? `optimistic:${batchId}:${file.name}:${file.lastModified}:${file.size}`,
      uploader_id: null,
      owner_id: null,
      visibility,
      filename: file.name,
      original_filename: file.name,
      media_type: mediaType,
      metadata: {
        file_size: file.size,
        width: null,
        height: null,
        duration_seconds: null,
        frame_count: null,
        mime_type: file.type || null,
        captured_at: this.capturedAtForFile(file),
      },
      version: 1,
      uploaded_at: new Date().toISOString(),
      deleted_at: null,
      tags: [],
      ocr_text_override: null,
      is_nsfw: false,
      tagging_status: TaggingStatus.PENDING,
      tagging_error: null,
      thumbnail_status: mediaType === MediaType.VIDEO
        ? ProcessingStatus.NOT_APPLICABLE
        : ProcessingStatus.PENDING,
      poster_status: mediaType === MediaType.VIDEO
        ? ProcessingStatus.PENDING
        : ProcessingStatus.NOT_APPLICABLE,
      ocr_text: null,
      is_favorited: false,
      favorite_count: 0,
      client_preview_url: mediaType === MediaType.IMAGE || mediaType === MediaType.GIF
        ? URL.createObjectURL(file)
        : null,
      client_is_optimistic: true,
      client_batch_id: batchId,
      client_source_filename: file.name,
    };
  }

  resolveOptimisticMediaId(batchId: string, sourceFilename: string, mediaId: string): void {
    this._optimisticItems.update((items) => {
      const matchIndex = items.findIndex((item) =>
        item.client_is_optimistic
        && item.client_batch_id === batchId
        && item.client_source_filename === sourceFilename,
      );

      if (matchIndex < 0) {
        return items;
      }

      const next = items.slice();
      next[matchIndex] = {
        ...next[matchIndex],
        id: mediaId,
      };
      return next;
    });
  }

  private mediaTypeFromFile(file: File): MediaType {
    const lowerName = file.name.toLowerCase();
    const dotIndex = lowerName.lastIndexOf('.');
    const extension = dotIndex >= 0 ? lowerName.slice(dotIndex) : '';

    if (file.type === 'image/gif' || GIF_EXTENSIONS.has(extension)) {
      return MediaType.GIF;
    }

    if (file.type.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) {
      return MediaType.VIDEO;
    }

    return MediaType.IMAGE;
  }

  private capturedAtForFile(file: File): string {
    if (Number.isFinite(file.lastModified) && file.lastModified > 0) {
      return new Date(file.lastModified).toISOString();
    }

    return new Date().toISOString();
  }

  private dropOptimisticItems(ids: string[]): void {
    if (ids.length === 0) {
      return;
    }

    const idSet = new Set(ids);
    const toRevoke = this._optimisticItems().filter((item) => idSet.has(item.id));
    if (toRevoke.length === 0) {
      return;
    }

    this.revokeOptimisticItems(toRevoke);
    this._optimisticItems.update((items) => items.filter((item) => !idSet.has(item.id)));
  }

  private revokeOptimisticItems(items: MediaRead[]): void {
    for (const item of items) {
      if (item.client_preview_url) {
        URL.revokeObjectURL(item.client_preview_url);
      }
    }
  }

  private sortItems(items: MediaRead[]): MediaRead[] {
    if (this._params().sort_by != null) {
      return items;
    }
    return items.slice().sort((left, right) => {
      const rightDate = right.metadata.captured_at || right.uploaded_at || '';
      const leftDate = left.metadata.captured_at || left.uploaded_at || '';
      return rightDate.localeCompare(leftDate);
    });
  }

  private loadedItems(): MediaRead[] {
    return Array.from(this._months().values()).flatMap((month) => month.items);
  }

  private replaceMonthsFromPage(page: MediaCursorPage): void {
    const months = new Map<string, GalleryMonthState>();
    for (const item of page.items) {
      const key = this.monthKeyForMedia(item);
      const current = months.get(key) ?? this.emptyMonthState(key);
      months.set(key, {
        ...current,
        loaded: true,
        items: [...current.items, item],
      });
    }
    const last = page.items[page.items.length - 1];
    if (last) {
      const key = this.monthKeyForMedia(last);
      const current = months.get(key);
      if (current) {
        months.set(key, {
          ...current,
          cursor: page.next_cursor,
          hasMore: page.has_more,
        });
      }
    }
    this._months.set(months);
  }

  private updateLoadedItems(update: (item: MediaRead) => MediaRead): void {
    this._months.update((months) => {
      const next = new Map(months);
      for (const [key, month] of next) {
        next.set(key, {
          ...month,
          items: month.items.map(update),
        });
      }
      return next;
    });
  }

  private removeLoadedItems(ids: string[]): void {
    const set = new Set(ids);
    this._months.update((months) => {
      const next = new Map(months);
      for (const [key, month] of next) {
        next.set(key, {
          ...month,
          items: month.items.filter((item) => !set.has(item.id)),
        });
      }
      return next;
    });
  }

  private upsertMonthState(key: string, patch: Partial<GalleryMonthState>): void {
    this._months.update((months) => {
      const next = new Map(months);
      const current = next.get(key) ?? this.emptyMonthState(key);
      next.set(key, { ...current, ...patch, key });
      return next;
    });
  }

  private emptyMonthState(key: string): GalleryMonthState {
    const parsed = this.parseMonthKey(key);
    return {
      key,
      year: parsed.year,
      month: parsed.month,
      items: [],
      cursor: null,
      hasMore: false,
      loading: false,
      loaded: false,
      estimatedCount: this.bucketForMonthKey(key)?.count ?? 0,
    };
  }

  private bucketForMonthKey(key: string): TimelineBucket | undefined {
    return this._timeline().find((bucket) => this.monthKey(bucket.year, bucket.month) === key);
  }

  private monthKeyForMedia(item: MediaRead): string {
    const value = item.metadata.captured_at || item.uploaded_at || new Date().toISOString();
    return value.slice(0, 7);
  }

  private monthKey(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  private parseMonthKey(key: string): { year: number; month: number } {
    const [year, month] = key.split('-').map(Number);
    return { year: year || 0, month: month || 0 };
  }

  private shouldRemoveAfterFavoriteToggle(nextFavorited: boolean): boolean {
    const activeFavoritedFilter = this._params().favorited;
    return activeFavoritedFilter != null && activeFavoritedFilter !== nextFavorited;
  }

  private isStillProcessing(item: MediaRead): boolean {
    if (item.media_type === MediaType.VIDEO) {
      return item.poster_status === ProcessingStatus.PENDING
        || item.poster_status === ProcessingStatus.PROCESSING;
    }

    return item.thumbnail_status === ProcessingStatus.PENDING
      || item.thumbnail_status === ProcessingStatus.PROCESSING;
  }

  private fetchAllMatchingIds(): Observable<string[]> {
    const baseParams: MediaSearchParams = {
      ...this._params(),
      after: undefined,
      page_size: GalleryStore.PAGE_SIZE,
      include_total: false,
    };

    return this.client.search(baseParams).pipe(
      expand((page) => {
        if (!page.has_more || !page.next_cursor) {
          return EMPTY;
        }

        return this.client.search({
          ...baseParams,
          after: page.next_cursor,
        });
      }),
      reduce((ids, page) => ([
        ...ids,
        ...page.items.map((item) => item.id),
      ]), [] as string[]),
    );
  }

  private chunkIds(ids: string[], size = GalleryStore.BULK_MUTATION_CHUNK_SIZE): string[][] {
    const chunks: string[][] = [];
    for (let index = 0; index < ids.length; index += size) {
      chunks.push(ids.slice(index, index + size));
    }
    return chunks;
  }
}
