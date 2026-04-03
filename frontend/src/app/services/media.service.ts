import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { HttpEvent, HttpEventType, HttpResponse } from '@angular/common/http';
import { catchError, EMPTY, filter, finalize, map, Observable, shareReplay, tap, throwError } from 'rxjs';
import { MediaClientService, MediaSearchParams, UploadParams } from './web/media-client.service';
import { BlobUrlCache } from '../utils/blob-url.utils';
import { MediaCursorPage, MediaDetail, MediaEntityBatchUpdate, MediaRead, MediaUpdate, MediaVisibility } from '../models/media';
import { BatchUploadResponse, TaggingJobQueuedResponse } from '../models/uploads';
import { BulkResult } from '../models/common';
import { CharacterSuggestion, SeriesSuggestion } from '../models/tags';

@Injectable({ providedIn: 'root' })
export class MediaService implements OnDestroy {
  private readonly client = inject(MediaClientService);

  private readonly _items = signal<MediaRead[]>([]);
  private readonly _hasMore = signal(false);
  private readonly _cursor = signal<string | null>(null);
  private readonly _total = signal<number | null>(null);
  private readonly _loading = signal(false);

  private _activeParams: MediaSearchParams = {};

  private readonly thumbnailCache = new BlobUrlCache();
  private readonly posterCache = new BlobUrlCache();
  private readonly thumbnailRequests = new Map<string, Observable<string>>();
  private readonly posterRequests = new Map<string, Observable<string>>();

  readonly items = this._items.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();

  load(params: MediaSearchParams = {}): Observable<MediaCursorPage> {
    this._activeParams = params;
    this._loading.set(true);
    return this.client.search(params).pipe(
      tap(page => {
        this._items.set(page.items);
        this._cursor.set(page.next_cursor);
        this._hasMore.set(page.has_more);
        this._total.set(page.total);
        this._loading.set(false);
      }),
      catchError(err => {
        this._loading.set(false);
        return throwError(() => err);
      }),
    );
  }

  loadMore(): Observable<MediaCursorPage> {
    if (!this._hasMore() || this._loading()) return EMPTY;
    this._loading.set(true);
    const params = { ...this._activeParams, after: this._cursor() ?? undefined };
    return this.client.search(params).pipe(
      tap(page => {
        this._items.update(prev => [...prev, ...page.items]);
        this._cursor.set(page.next_cursor);
        this._hasMore.set(page.has_more);
        this._loading.set(false);
      }),
      catchError(err => {
        this._loading.set(false);
        return throwError(() => err);
      }),
    );
  }

  reset(): void {
    this._items.set([]);
    this._cursor.set(null);
    this._hasMore.set(false);
    this._total.set(null);
    this._loading.set(false);
    this._activeParams = {};
  }

  get(id: string): Observable<MediaDetail> {
    return this.client.get(id);
  }

  update(id: string, body: MediaUpdate): Observable<MediaDetail> {
    return this.client.update(id, body).pipe(
      tap(updated => this._patchItem(updated)),
    );
  }

  delete(id: string): Observable<void> {
    return this.client.delete(id).pipe(
      tap(() => this._removeItem(id)),
    );
  }

  restore(id: string): Observable<void> {
    return this.client.restore(id).pipe(
      tap(() => this._removeItem(id)),
    );
  }

  purge(id: string): Observable<void> {
    return this.client.purge(id).pipe(
      tap(() => {
        this._removeItem(id);
        this.thumbnailCache.delete(id);
        this.posterCache.delete(id);
      }),
    );
  }

  batchDelete(ids: string[]): Observable<BulkResult> {
    return this.client.batchDelete({ media_ids: ids }).pipe(
      tap(() => this._removeItems(ids)),
    );
  }

  batchPurge(ids: string[]): Observable<BulkResult> {
    return this.client.batchPurge({ media_ids: ids }).pipe(
      tap(() => {
        this._removeItems(ids);
        ids.forEach(id => {
          this.thumbnailCache.delete(id);
          this.posterCache.delete(id);
        });
      }),
    );
  }

  batchFavorite(ids: string[], favorited: boolean): Observable<BulkResult> {
    return this.client.batchUpdate({ media_ids: ids, favorited }).pipe(
      tap(() => {
        const set = new Set(ids);
        this._items.update(items =>
          items.map(item => set.has(item.id) ? { ...item, is_favorited: favorited } : item),
        );
      }),
    );
  }

  batchUpdateVisibility(ids: string[], visibility: MediaVisibility): Observable<BulkResult> {
    return this.client.batchUpdate({ media_ids: ids, visibility }).pipe(
      tap(() => {
        const set = new Set(ids);
        this._items.update(items =>
          items.map(item => set.has(item.id) ? { ...item, visibility } : item),
        );
      }),
    );
  }

  batchUpdateEntities(body: MediaEntityBatchUpdate): Observable<BulkResult> {
    return this.client.batchUpdateEntities(body);
  }

  upload(files: File[], params?: UploadParams): Observable<BatchUploadResponse> {
    return this.client.upload(files, params).pipe(
      filter((event): event is HttpResponse<BatchUploadResponse> => event.type === HttpEventType.Response),
      map((event) => event.body!),
    );
  }

  uploadWithProgress(files: File[], params?: UploadParams): Observable<HttpEvent<BatchUploadResponse>> {
    return this.client.upload(files, params);
  }

  download(ids: string[]): Observable<Blob> {
    return this.client.download({ media_ids: ids });
  }

  queueTaggingJob(id: string): Observable<TaggingJobQueuedResponse> {
    return this.client.queueTaggingJob(id);
  }

  batchQueueTaggingJobs(ids: string[]): Observable<TaggingJobQueuedResponse> {
    return this.client.batchQueueTaggingJobs({ media_ids: ids });
  }

  getCharacterSuggestions(q: string, limit?: number): Observable<CharacterSuggestion[]> {
    return this.client.getCharacterSuggestions(q, limit);
  }

  getSeriesSuggestions(q: string, limit?: number): Observable<SeriesSuggestion[]> {
    return this.client.getSeriesSuggestions(q, limit);
  }

  getThumbnailUrl(id: string): Observable<string> {
    const cached = this.thumbnailCache.get(id);
    if (cached) return new Observable(s => { s.next(cached); s.complete(); });

    const pending = this.thumbnailRequests.get(id);
    if (pending) {
      return pending;
    }

    const request = this.client.getThumbnail(id).pipe(
      map(blob => this.thumbnailCache.set(id, blob)),
      finalize(() => this.thumbnailRequests.delete(id)),
      shareReplay(1),
    );
    this.thumbnailRequests.set(id, request);
    return request;
  }

  getPosterUrl(id: string): Observable<string> {
    const cached = this.posterCache.get(id);
    if (cached) return new Observable(s => { s.next(cached); s.complete(); });

    const pending = this.posterRequests.get(id);
    if (pending) {
      return pending;
    }

    const request = this.client.getPoster(id).pipe(
      map(blob => this.posterCache.set(id, blob)),
      finalize(() => this.posterRequests.delete(id)),
      shareReplay(1),
    );
    this.posterRequests.set(id, request);
    return request;
  }

  getFileUrl(id: string): Observable<string> {
    return this.client.getFile(id).pipe(
      map(blob => URL.createObjectURL(blob)),
    );
  }

  ngOnDestroy(): void {
    this.thumbnailCache.clear();
    this.posterCache.clear();
  }

  private _patchItem(updated: MediaRead): void {
    this._items.update(items =>
      items.map(item => item.id === updated.id ? updated : item),
    );
  }

  private _removeItem(id: string): void {
    this._items.update(items => items.filter(item => item.id !== id));
    this._total.update(t => t != null ? t - 1 : null);
  }

  private _removeItems(ids: string[]): void {
    const set = new Set(ids);
    const before = this._items().length;
    this._items.update(items => items.filter(item => !set.has(item.id)));
    const removed = before - this._items().length;
    this._total.update(t => t != null ? t - removed : null);
  }
}
