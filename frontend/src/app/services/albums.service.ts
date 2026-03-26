import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, catchError, distinctUntilChanged, finalize, map, Observable, tap, throwError } from 'rxjs';

import {
  AlbumCreateDto,
  AlbumListResponse,
  AlbumMediaBatchUpdateDto,
  AlbumOwnershipTransferDto,
  AlbumRead,
  AlbumShareCreateDto,
  AlbumShareRead,
  AlbumUpdateDto,
  BulkResult,
  ListAlbumsQuery,
  ListAlbumMediaQuery,
  MediaCursorPage,
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
import { AlbumsClientService } from './web/albums-client.service';

export interface AlbumsState {
  albums: AlbumRead[];
  selectedAlbum: AlbumRead | null;
  selectedAlbumMedia: MediaCursorPage | null;
  selectedAlbumMediaQuery: ListAlbumMediaQuery | null;
  request: RequestStatus;
  detailRequest: RequestStatus;
  mediaRequest: RequestStatus;
  mutationPending: boolean;
  mutationError: unknown | null;
}

const initialAlbumsState = (): AlbumsState => ({
  albums: [],
  selectedAlbum: null,
  selectedAlbumMedia: null,
  selectedAlbumMediaQuery: null,
  request: createRequestStatus(),
  detailRequest: createRequestStatus(),
  mediaRequest: createRequestStatus(),
  mutationPending: false,
  mutationError: null
});

@Injectable({
  providedIn: 'root'
})
export class AlbumsService {
  private readonly albumsClient = inject(AlbumsClientService);
  private readonly stateSubject = new BehaviorSubject<AlbumsState>(initialAlbumsState());

  readonly state$ = this.stateSubject.asObservable();
  readonly albums$ = this.state$.pipe(
    map((state) => state.albums),
    distinctUntilChanged()
  );
  readonly selectedAlbum$ = this.state$.pipe(
    map((state) => state.selectedAlbum),
    distinctUntilChanged()
  );
  readonly selectedAlbumMedia$ = this.state$.pipe(
    map((state) => state.selectedAlbumMedia),
    distinctUntilChanged()
  );
  readonly loading$ = this.state$.pipe(
    map((state) => state.request.loading || state.detailRequest.loading || state.mediaRequest.loading || state.mutationPending),
    distinctUntilChanged()
  );
  readonly error$ = this.state$.pipe(
    map((state) => state.mutationError ?? state.mediaRequest.error ?? state.detailRequest.error ?? state.request.error),
    distinctUntilChanged()
  );

  get snapshot(): AlbumsState {
    return this.stateSubject.value;
  }

  loadAlbums(query?: ListAlbumsQuery): Observable<AlbumRead[]> {
    this.patchState({
      request: beginRequest(this.stateSubject.value.request)
    });

    return this.albumsClient.listAlbums(query).pipe(
      map((response: AlbumListResponse) => response.items),
      tap((albums) => {
        this.patchState({
          albums,
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

  createAlbum(body: AlbumCreateDto): Observable<AlbumRead> {
    this.startMutation();

    return this.albumsClient.createAlbum(body).pipe(
      tap((album) => {
        this.patchState({
          albums: [album, ...this.stateSubject.value.albums]
        });
        this.finishMutation();
      }),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  loadAlbum(albumId: Uuid): Observable<AlbumRead> {
    this.patchState({
      detailRequest: beginRequest(this.stateSubject.value.detailRequest)
    });

    return this.albumsClient.getAlbum(albumId).pipe(
      tap((album) => {
        this.patchState({
          selectedAlbum: album,
          albums: this.upsertAlbum(album),
          detailRequest: completeRequest(this.stateSubject.value.detailRequest)
        });
      }),
      catchError((error) => {
        this.patchState({
          detailRequest: failRequest(this.stateSubject.value.detailRequest, error)
        });
        return throwError(() => error);
      })
    );
  }

  updateAlbum(albumId: Uuid, body: AlbumUpdateDto): Observable<AlbumRead> {
    this.startMutation();

    return this.albumsClient.updateAlbum(albumId, body).pipe(
      tap((album) => {
        this.patchState({
          albums: this.upsertAlbum(album),
          selectedAlbum: this.stateSubject.value.selectedAlbum?.id === albumId ? album : this.stateSubject.value.selectedAlbum
        });
        this.finishMutation();
      }),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  deleteAlbum(albumId: Uuid): Observable<void> {
    this.startMutation();

    return this.albumsClient.deleteAlbum(albumId).pipe(
      tap(() => {
        this.patchState({
          albums: removeItemById(this.stateSubject.value.albums, albumId),
          selectedAlbum: this.stateSubject.value.selectedAlbum?.id === albumId ? null : this.stateSubject.value.selectedAlbum,
          selectedAlbumMedia: this.stateSubject.value.selectedAlbum?.id === albumId ? null : this.stateSubject.value.selectedAlbumMedia,
          selectedAlbumMediaQuery: this.stateSubject.value.selectedAlbum?.id === albumId ? null : this.stateSubject.value.selectedAlbumMediaQuery
        });
        this.finishMutation();
      }),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  loadAlbumMedia(albumId: Uuid, query?: ListAlbumMediaQuery): Observable<MediaCursorPage> {
    this.patchState({
      mediaRequest: beginRequest(this.stateSubject.value.mediaRequest),
      selectedAlbumMediaQuery: query ?? null
    });

    return this.albumsClient.listAlbumMedia(albumId, query).pipe(
      tap((selectedAlbumMedia) => {
        this.patchState({
          selectedAlbumMedia,
          mediaRequest: completeRequest(this.stateSubject.value.mediaRequest)
        });
      }),
      catchError((error) => {
        this.patchState({
          mediaRequest: failRequest(this.stateSubject.value.mediaRequest, error)
        });
        return throwError(() => error);
      })
    );
  }

  refreshAlbumMedia(): Observable<MediaCursorPage> {
    const selectedAlbum = this.stateSubject.value.selectedAlbum;
    if (!selectedAlbum) {
      return throwError(() => new Error('No album selected'));
    }

    return this.loadAlbumMedia(selectedAlbum.id, this.stateSubject.value.selectedAlbumMediaQuery ?? undefined);
  }

  addMedia(albumId: Uuid, body: AlbumMediaBatchUpdateDto): Observable<BulkResult> {
    this.startMutation();

    return this.albumsClient.addMediaToAlbum(albumId, body).pipe(
      tap(() => {
        this.patchSelectedAlbumCount(albumId, body.media_ids.length);
        this.invalidateSelectedAlbumMediaIfNeeded(albumId);
        this.finishMutation();
      }),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  removeMedia(albumId: Uuid, body: AlbumMediaBatchUpdateDto): Observable<BulkResult> {
    this.startMutation();

    return this.albumsClient.removeMediaFromAlbum(albumId, body).pipe(
      tap(() => {
        this.patchSelectedAlbumCount(albumId, -body.media_ids.length);
        const selectedAlbumMedia = this.stateSubject.value.selectedAlbumMedia;
        if (this.stateSubject.value.selectedAlbum?.id === albumId && selectedAlbumMedia) {
          this.patchState({
            selectedAlbumMedia: {
              ...selectedAlbumMedia,
              items: selectedAlbumMedia.items.filter((item) => !body.media_ids.includes(item.id)),
              total: selectedAlbumMedia.total != null
                ? Math.max(0, selectedAlbumMedia.total - body.media_ids.length)
                : null
            }
          });
        } else {
          this.invalidateSelectedAlbumMediaIfNeeded(albumId);
        }
        this.finishMutation();
      }),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  shareAlbum(albumId: Uuid, body: AlbumShareCreateDto): Observable<AlbumShareRead> {
    this.startMutation();

    return this.albumsClient.shareAlbum(albumId, body).pipe(
      tap(() => this.finishMutation()),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  revokeShare(albumId: Uuid, sharedUserId: Uuid): Observable<void> {
    this.startMutation();

    return this.albumsClient.revokeShare(albumId, sharedUserId).pipe(
      tap(() => this.finishMutation()),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  transferOwnership(albumId: Uuid, body: AlbumOwnershipTransferDto): Observable<AlbumRead> {
    this.startMutation();

    return this.albumsClient.transferOwnership(albumId, body).pipe(
      tap((album) => {
        this.patchState({
          albums: this.upsertAlbum(album),
          selectedAlbum: this.stateSubject.value.selectedAlbum?.id === albumId ? album : this.stateSubject.value.selectedAlbum
        });
        this.finishMutation();
      }),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  downloadAlbum(albumId: Uuid): Observable<Blob> {
    return this.albumsClient.downloadAlbum(albumId);
  }

  private upsertAlbum(album: AlbumRead): AlbumRead[] {
    const exists = this.stateSubject.value.albums.some((item) => item.id === album.id);
    return exists
      ? replaceItemById(this.stateSubject.value.albums, album)
      : [album, ...this.stateSubject.value.albums];
  }

  private patchSelectedAlbumCount(albumId: Uuid, delta: number): void {
    const currentSelectedAlbum = this.stateSubject.value.selectedAlbum;
    const selectedAlbum = currentSelectedAlbum?.id === albumId
      ? { ...currentSelectedAlbum, media_count: Math.max(0, currentSelectedAlbum.media_count + delta) }
      : currentSelectedAlbum;

    const albums = this.stateSubject.value.albums.map((album) => {
      if (album.id !== albumId) {
        return album;
      }

      return {
        ...album,
        media_count: Math.max(0, album.media_count + delta)
      };
    });

    this.patchState({
      selectedAlbum,
      albums
    });
  }

  private invalidateSelectedAlbumMediaIfNeeded(albumId: Uuid): void {
    if (this.stateSubject.value.selectedAlbum?.id !== albumId) {
      return;
    }

    this.patchState({
      selectedAlbumMedia: null,
      mediaRequest: {
        ...this.stateSubject.value.mediaRequest,
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

  private patchState(patch: Partial<AlbumsState>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch
    });
  }
}
