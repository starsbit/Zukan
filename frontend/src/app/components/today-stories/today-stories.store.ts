import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, EMPTY, expand, map, Observable, of, reduce, tap, throwError } from 'rxjs';
import { GalleryStore } from '../../services/gallery.store';
import { MediaClientService, MediaSearchParams } from '../../services/web/media-client.service';
import { MediaRead } from '../../models/media';
import { TodayStoryGroup, TodayStoryItem } from '../../models/today-stories';
import { groupTodayStoryItems, sortTodayStoryItems, toTodayStoryItem } from '../../utils/today-stories.utils';

@Injectable()
export class TodayStoriesStore {
  private readonly client = inject(MediaClientService);
  private readonly galleryStore = inject(GalleryStore);

  private readonly _params = signal<MediaSearchParams | null>(null);
  private readonly _items = signal<TodayStoryItem[]>([]);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);

  readonly params = this._params.asReadonly();
  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly hasItems = computed(() => this._items().length > 0);
  readonly groups = computed<TodayStoryGroup[]>(() => groupTodayStoryItems(this._items()));

  setParams(params: MediaSearchParams): void {
    const current = this._params();
    if (JSON.stringify(current) === JSON.stringify(params)) {
      return;
    }

    this._params.set(params);
    this.load().subscribe({ error: () => {} });
  }

  load(): Observable<TodayStoryItem[]> {
    const params = this._params();
    if (!params) {
      this._items.set([]);
      this._loaded.set(true);
      return of([]);
    }

    const baseParams: MediaSearchParams = {
      ...params,
      after: undefined,
      page_size: 100,
      include_total: false,
    };

    this._loading.set(true);
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
      reduce((items, page) => [...items, ...page.items], [] as MediaRead[]),
      map((items) => sortTodayStoryItems(items.map((item) => toTodayStoryItem(item)))),
      tap((items) => {
        this._items.set(items);
        this._loading.set(false);
        this._loaded.set(true);
      }),
      catchError((error) => {
        this._loading.set(false);
        this._loaded.set(true);
        return throwError(() => error);
      }),
    );
  }

  toggleFavorite(item: TodayStoryItem): Observable<TodayStoryItem> {
    const nextFavorited = !item.is_favorited;
    const optimisticItem = this.withFavoriteState(item, nextFavorited);
    this.patchStoryItem(optimisticItem);
    this.patchPageItem(optimisticItem);

    return this.client.batchUpdate({ media_ids: [item.id], favorited: nextFavorited }).pipe(
      map(() => optimisticItem),
      catchError((error) => {
        this.patchStoryItem(item);
        this.patchPageItem(item);
        return throwError(() => error);
      }),
    );
  }

  private withFavoriteState(item: TodayStoryItem, isFavorited: boolean): TodayStoryItem {
    return {
      ...item,
      is_favorited: isFavorited,
      favorite_count: Math.max(0, (item.favorite_count ?? 0) + (isFavorited ? 1 : -1)),
    };
  }

  private patchStoryItem(item: TodayStoryItem): void {
    this._items.update((items) => {
      const removeAfterUnfavorite = this.params()?.favorited === true && !item.is_favorited;
      if (removeAfterUnfavorite) {
        return items.filter((candidate) => candidate.id !== item.id);
      }

      return items.map((candidate) => candidate.id === item.id ? item : candidate);
    });
  }

  private patchPageItem(item: TodayStoryItem): void {
    const removeAfterUnfavorite = this.params()?.favorited === true && !item.is_favorited;
    if (removeAfterUnfavorite) {
      this.galleryStore.removeItem(item.id);
      return;
    }

    this.galleryStore.patchItem(item);
  }
}
