import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, catchError, distinctUntilChanged, finalize, map, Observable, of, tap, throwError } from 'rxjs';

import {
  BatchUploadResponse,
  BulkResult,
  DownloadRequestDto,
  ListMediaQuery,
  MediaBatchDeleteDto,
  MediaBatchUpdateDto,
  MediaCursorPage,
  MediaDetail,
  MediaRead,
  MediaUpdateDto,
  TaggingJobQueuedResponse,
  Uuid
} from '../models/api';
import {
  beginRequest,
  completeRequest,
  createRequestStatus,
  failRequest,
  patchItemById,
  removeItemById,
  replaceItemById,
  type RequestStatus
} from './store.utils';
import { MediaClientService } from './web/media-client.service';

export interface MediaState {
  page: MediaCursorPage | null;
  pageQuery: ListMediaQuery | null;
  details: Record<Uuid, MediaDetail>;
  selectedMediaId: Uuid | null;
  request: RequestStatus;
  mutationPending: boolean;
  mutationError: unknown | null;
}

const initialMediaState = (): MediaState => ({
  page: null,
  pageQuery: null,
  details: {},
  selectedMediaId: null,
  request: createRequestStatus(),
  mutationPending: false,
  mutationError: null
});

@Injectable({
  providedIn: 'root'
})
export class MediaService {
  private readonly mediaClient = inject(MediaClientService);
  private readonly stateSubject = new BehaviorSubject<MediaState>(initialMediaState());

  readonly state$ = this.stateSubject.asObservable();
  readonly mediaPage$ = this.state$.pipe(
    map((state) => state.page),
    distinctUntilChanged()
  );
  readonly items$ = this.state$.pipe(
    map((state) => state.page?.items ?? []),
    distinctUntilChanged()
  );
  readonly selectedMedia$ = this.state$.pipe(
    map((state) => state.selectedMediaId ? state.details[state.selectedMediaId] ?? null : null),
    distinctUntilChanged()
  );
  readonly requestLoading$ = this.state$.pipe(
    map((state) => state.request.loading),
    distinctUntilChanged()
  );
  readonly mutationPending$ = this.state$.pipe(
    map((state) => state.mutationPending),
    distinctUntilChanged()
  );
  readonly loading$ = this.state$.pipe(
    map((state) => state.request.loading || state.mutationPending),
    distinctUntilChanged()
  );
  readonly loaded$ = this.state$.pipe(
    map((state) => state.request.loaded),
    distinctUntilChanged()
  );
  readonly error$ = this.state$.pipe(
    map((state) => state.mutationError ?? state.request.error),
    distinctUntilChanged()
  );

  get snapshot(): MediaState {
    return this.stateSubject.value;
  }

  loadPage(query?: ListMediaQuery): Observable<MediaCursorPage> {
    this.patchState({
      pageQuery: query ?? null,
      request: beginRequest(this.stateSubject.value.request)
    });

    return this.mediaClient.listMedia(query).pipe(
      tap((page) => {
        this.patchState({
          page,
          pageQuery: query ?? null,
          request: completeRequest(this.stateSubject.value.request)
        });
      }),
      catchError((error) => {
        this.patchState({
          request: failRequest(this.stateSubject.value.request, error)
        });
        return throwError(() => error);
      })
    );
  }

  refreshPage(): Observable<MediaCursorPage> {
    return this.loadPage(this.stateSubject.value.pageQuery ?? undefined);
  }

  loadNextPage(): Observable<MediaCursorPage | null> {
    const state = this.stateSubject.value;
    const page = state.page;

    if (!page || state.request.loading) {
      return of(null);
    }

    if (!page.next_cursor) {
      return of(null);
    }

    const nextQuery: ListMediaQuery = {
      ...(state.pageQuery ?? {}),
      after: page.next_cursor,
      page_size: (state.pageQuery?.page_size ?? page.page_size)
    };

    this.patchState({
      request: beginRequest(state.request)
    });

    return this.mediaClient.listMedia(nextQuery).pipe(
      tap((next) => {
        const currentPage = this.stateSubject.value.page;
        const mergedItems = mergePageItems(currentPage?.items ?? [], next.items);

        this.patchState({
          page: {
            ...next,
            items: mergedItems
          },
          request: completeRequest(this.stateSubject.value.request)
        });
      }),
      catchError((error) => {
        this.patchState({
          request: failRequest(this.stateSubject.value.request, error)
        });
        return throwError(() => error);
      })
    );
  }

  selectMedia(mediaId: Uuid): Observable<MediaDetail> {
    const cached = this.stateSubject.value.details[mediaId];
    this.patchState({
      selectedMediaId: mediaId
    });

    if (cached) {
      return new Observable<MediaDetail>((subscriber) => {
        subscriber.next(cached);
        subscriber.complete();
      });
    }

    return this.loadMedia(mediaId);
  }

  loadMedia(mediaId: Uuid): Observable<MediaDetail> {
    this.patchState({
      request: beginRequest(this.stateSubject.value.request),
      selectedMediaId: mediaId
    });

    return this.mediaClient.getMedia(mediaId).pipe(
      tap((media) => {
        this.patchState({
          details: {
            ...this.stateSubject.value.details,
            [mediaId]: media
          },
          request: completeRequest(this.stateSubject.value.request)
        });
        this.applyMediaToPage(media);
      }),
      catchError((error) => {
        this.patchState({
          request: failRequest(this.stateSubject.value.request, error)
        });
        return throwError(() => error);
      })
    );
  }

  uploadMedia(files: File[]): Observable<BatchUploadResponse> {
    this.startMutation();

    return this.mediaClient.uploadMedia(files).pipe(
      tap(() => this.invalidatePage()),
      tap(() => this.finishMutation()),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  updateMedia(mediaId: Uuid, body: MediaUpdateDto): Observable<MediaDetail> {
    this.startMutation();

    return this.mediaClient.updateMedia(mediaId, body).pipe(
      tap((media) => {
        this.patchState({
          details: {
            ...this.stateSubject.value.details,
            [mediaId]: media
          }
        });
        this.applyMediaUpdateToPage(media, body);
        this.finishMutation();
      }),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  batchUpdateMedia(body: MediaBatchUpdateDto): Observable<BulkResult> {
    this.startMutation();

    return this.mediaClient.batchUpdateMedia(body).pipe(
      tap((result) => {
        this.patchBatchMedia(body);
        this.finishMutation();
        return result;
      }),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  batchDeleteMedia(body: MediaBatchDeleteDto): Observable<BulkResult> {
    this.startMutation();

    return this.mediaClient.batchDeleteMedia(body).pipe(
      tap(() => {
        this.removeDetails(body.media_ids);
        if (this.stateSubject.value.page) {
          this.patchState({
            page: {
              ...this.stateSubject.value.page,
              items: this.stateSubject.value.page.items.filter((item) => !body.media_ids.includes(item.id)),
              total: Math.max(0, this.stateSubject.value.page.total - body.media_ids.length)
            }
          });
        }
        this.finishMutation();
      }),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  deleteMedia(mediaId: Uuid): Observable<void> {
    this.startMutation();

    return this.mediaClient.deleteMedia(mediaId).pipe(
      tap(() => {
        this.removeDetails([mediaId]);
        const page = this.stateSubject.value.page;
        const pageQuery = this.stateSubject.value.pageQuery;

        if (page) {
          if (pageQuery?.state === 'trashed') {
            this.invalidatePage();
          } else {
            this.patchState({
              page: {
                ...page,
                items: removeItemById(page.items, mediaId),
                total: Math.max(0, page.total - 1)
              }
            });
          }
        }

        if (this.stateSubject.value.selectedMediaId === mediaId) {
          this.patchState({
            selectedMediaId: null
          });
        }

        this.finishMutation();
      }),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  emptyTrash(): Observable<void> {
    this.startMutation();

    return this.mediaClient.emptyTrash().pipe(
      tap(() => {
        if (this.stateSubject.value.pageQuery?.state === 'trashed') {
          this.patchState({
            page: this.stateSubject.value.page
              ? { ...this.stateSubject.value.page, items: [], total: 0 }
              : { items: [], next_cursor: null, page_size: 0, total: 0 }
          });
        } else {
          this.invalidatePage();
        }

        this.finishMutation();
      }),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  queueTaggingJob(mediaId: Uuid): Observable<TaggingJobQueuedResponse> {
    this.startMutation();

    return this.mediaClient.queueTaggingJob(mediaId).pipe(
      tap(() => this.finishMutation()),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  downloadMedia(body: DownloadRequestDto): Observable<Blob> {
    return this.mediaClient.downloadMedia(body);
  }

  getMediaFile(mediaId: Uuid): Observable<Blob> {
    return this.mediaClient.getMediaFile(mediaId);
  }

  getMediaThumbnail(mediaId: Uuid): Observable<Blob> {
    return this.mediaClient.getMediaThumbnail(mediaId);
  }

  restoreMedia(mediaId: Uuid): Observable<MediaDetail> {
    return this.updateMedia(mediaId, { deleted: false });
  }

  restoreMediaBatch(mediaIds: Uuid[]): Observable<BulkResult> {
    return this.batchUpdateMedia({ media_ids: mediaIds, deleted: false });
  }

  private patchBatchMedia(body: MediaBatchUpdateDto): void {
    const page = this.stateSubject.value.page;
    const ids = new Set(body.media_ids);

    const details = { ...this.stateSubject.value.details };
    for (const mediaId of body.media_ids) {
      delete details[mediaId];
    }

    if (!page) {
      this.patchState({ details });
      return;
    }

    const nextItems = page.items.flatMap((item) => {
      if (!ids.has(item.id)) {
        return [item];
      }

      const patched = patchMediaRead(item, body);
      const shouldRemoveFromCurrentView = shouldRemoveFromCurrentViewForDeletedState(
        this.stateSubject.value.pageQuery?.state,
        body.deleted
      );

      return shouldRemoveFromCurrentView ? [] : [patched];
    });

    const removedCount = page.items.length - nextItems.length;

    this.patchState({
      details,
      page: {
        ...page,
        items: nextItems,
        total: removedCount > 0 ? Math.max(0, page.total - removedCount) : page.total
      }
    });
  }

  private applyMediaUpdateToPage(media: MediaRead, body: MediaUpdateDto): void {
    const page = this.stateSubject.value.page;
    if (!page || !page.items.some((item) => item.id === media.id)) {
      return;
    }

    if (shouldRemoveFromCurrentViewForDeletedState(this.stateSubject.value.pageQuery?.state, body.deleted)) {
      this.patchState({
        page: {
          ...page,
          items: removeItemById(page.items, media.id),
          total: Math.max(0, page.total - 1)
        }
      });
      return;
    }

    this.patchState({
      page: {
        ...page,
        items: replaceItemById(page.items, media)
      }
    });
  }

  private applyMediaToPage(media: MediaRead): void {
    const page = this.stateSubject.value.page;
    if (!page || !page.items.some((item) => item.id === media.id)) {
      return;
    }

    this.patchState({
      page: {
        ...page,
        items: replaceItemById(page.items, media)
      }
    });
  }

  private removeDetails(mediaIds: Uuid[]): void {
    const details = { ...this.stateSubject.value.details };
    for (const mediaId of mediaIds) {
      delete details[mediaId];
    }

    this.patchState({
      details
    });
  }

  private invalidatePage(): void {
    this.patchState({
      page: null,
      request: {
        ...this.stateSubject.value.request,
        loaded: false
      }
    });
  }

  private startMutation(): void {
    this.patchState({
      mutationPending: true,
      mutationError: null
    });
  }

  private finishMutation(): void {
    this.patchState({
      mutationPending: false,
      mutationError: null
    });
  }

  private failMutation(error: unknown): Observable<never> {
    this.patchState({
      mutationPending: false,
      mutationError: error
    });

    return throwError(() => error);
  }

  private ensureMutationSettled(): void {
    if (!this.stateSubject.value.mutationPending) {
      return;
    }

    this.patchState({
      mutationPending: false
    });
  }

  private patchState(patch: Partial<MediaState>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch
    });
  }
}

function patchMediaRead(media: MediaRead, body: MediaBatchUpdateDto): MediaRead {
  return {
    ...media,
    is_favorited: body.favorited ?? media.is_favorited,
    deleted_at: body.deleted === true ? media.deleted_at ?? new Date().toISOString() : body.deleted === false ? null : media.deleted_at
  };
}

function shouldRemoveFromCurrentViewForDeletedState(
  viewState: ListMediaQuery['state'],
  deleted: boolean | null | undefined
): boolean {
  if (deleted === true) {
    return viewState !== 'trashed';
  }

  if (deleted === false) {
    return viewState === 'trashed';
  }

  return false;
}

function mergePageItems(existing: MediaRead[], next: MediaRead[]): MediaRead[] {
  if (existing.length === 0) {
    return [...next];
  }

  const seenIds = new Set(existing.map((item) => item.id));
  const merged = [...existing];

  for (const item of next) {
    if (seenIds.has(item.id)) {
      continue;
    }
    merged.push(item);
    seenIds.add(item.id);
  }

  return merged;
}
