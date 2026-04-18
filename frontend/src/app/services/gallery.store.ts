import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, concatMap, EMPTY, expand, forkJoin, from, map, Observable, of, reduce, switchMap, tap, throwError } from 'rxjs';
import { MediaClientService, MediaSearchParams } from './web/media-client.service';
import { groupByDay, groupTimelineByYear } from '../utils/gallery-grouping.utils';
import {
  MediaCursorPage,
  MediaRead,
  MediaType,
  MediaVisibility,
  ProcessingStatus,
  TaggingStatus,
} from '../models/media';
import { MediaTimeline, TimelineBucket } from '../models/timeline';

const GIF_EXTENSIONS = new Set(['.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);

@Injectable({ providedIn: 'root' })
export class GalleryStore {
  static readonly PAGE_SIZE = 1000;
  static readonly BULK_MUTATION_CHUNK_SIZE = 500;
  private readonly client = inject(MediaClientService);

  private readonly _params = signal<MediaSearchParams>({});
  private readonly _items = signal<MediaRead[]>([]);
  private readonly _optimisticItems = signal<MediaRead[]>([]);
  private readonly _cursor = signal<string | null>(null);
  private readonly _hasMore = signal(false);
  private readonly _total = signal<number | null>(null);
  private readonly _loading = signal(false);
  private readonly _timeline = signal<TimelineBucket[]>([]);
  private readonly _timelineLoading = signal(false);

  readonly params = this._params.asReadonly();
  readonly items = computed(() => {
    const optimistic = this._optimisticItems();
    if (optimistic.length === 0) {
      return this.sortItems(this._items());
    }

    const optimisticById = new Map(optimistic.map((item) => [item.id, item]));
    const serverItems = this._items().map((item) => {
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
  readonly hasMore = this._hasMore.asReadonly();
  readonly total = computed(() => {
    const total = this._total();
    if (total == null) {
      return null;
    }

    const serverIds = new Set(this._items().map((item) => item.id));
    const unresolvedOptimisticCount = this._optimisticItems().filter((item) => !serverIds.has(item.id)).length;
    return total + unresolvedOptimisticCount;
  });
  readonly loading = this._loading.asReadonly();
  readonly timeline = this._timeline.asReadonly();
  readonly timelineLoading = this._timelineLoading.asReadonly();

  readonly groupedByDay = computed(() => groupByDay(this.items()));
  readonly timelineByYear = computed(() => groupTimelineByYear(this._timeline()));

  setParams(params: MediaSearchParams): void {
    this._params.set(params);
    this._items.set([]);
    this._cursor.set(null);
    this._hasMore.set(false);
    this._total.set(null);
  }

  load(): Observable<MediaCursorPage> {
    this._loading.set(true);
    return this.client.search({ page_size: GalleryStore.PAGE_SIZE, ...this._params() }).pipe(
      tap((page) => {
        this._items.set(page.items);
        this._cursor.set(page.next_cursor);
        this._hasMore.set(page.has_more);
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
    if (!this._hasMore() || this._loading()) return EMPTY;
    this._loading.set(true);
    const params = { page_size: GalleryStore.PAGE_SIZE, ...this._params(), after: this._cursor() ?? undefined };
    return this.client.search(params).pipe(
      tap((page) => {
        this._items.update((prev) => [...prev, ...page.items]);
        this._cursor.set(page.next_cursor);
        this._hasMore.set(page.has_more);
        this._loading.set(false);
      }),
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

  patchItem(updated: MediaRead): void {
    this.dropOptimisticItems([updated.id]);
    this._items.update((items) =>
      items.some((item) => item.id === updated.id)
        ? items.map((item) => item.id === updated.id ? updated : item)
        : [updated, ...items],
    );
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
    this._items.update((items) => items.filter((item) => item.id !== id));
    this._total.update((t) => t != null ? t - 1 : null);
  }

  removeItems(ids: string[]): void {
    this.dropOptimisticItems(ids);
    const set = new Set(ids);
    const before = this._items().length;
    this._items.update((items) => items.filter((item) => !set.has(item.id)));
    const removed = before - this._items().length;
    this._total.update((t) => t != null ? t - removed : null);
  }

  batchDelete(ids: string[]): Observable<{ processed: number; skipped: number }> {
    return this.client.batchDelete({ media_ids: ids }).pipe(
      tap(() => this.removeItems(ids)),
      switchMap((result) =>
        forkJoin({
          page: this.load(),
          timeline: this.loadTimeline(),
        }).pipe(
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

  batchQueueTaggingJobs(ids: string[]): Observable<{ queued: number }> {
    return this.client.batchQueueTaggingJobs({ media_ids: ids }).pipe(
      tap(() => {
        const set = new Set(ids);
        this._items.update((items) =>
          items.map((item) => set.has(item.id)
            ? { ...item, tagging_status: TaggingStatus.PENDING, tagging_error: null }
            : item),
        );
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
    return forkJoin({
      page: this.load(),
      timeline: this.loadTimeline(),
    });
  }

  clearOptimisticItems(): void {
    this.revokeOptimisticItems(this._optimisticItems());
    this._optimisticItems.set([]);
  }

  reset(): void {
    this._params.set({});
    this._items.set([]);
    this.clearOptimisticItems();
    this._cursor.set(null);
    this._hasMore.set(false);
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
