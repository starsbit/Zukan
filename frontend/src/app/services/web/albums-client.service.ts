import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

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
} from '../../models/api';
import { ClientApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class AlbumsClientService {
  private readonly api = inject(ClientApiService);

  listAlbums(query?: ListAlbumsQuery): Observable<AlbumListResponse> {
    return this.api.get<AlbumListResponse>('/albums', { query });
  }

  createAlbum(body: AlbumCreateDto): Observable<AlbumRead> {
    return this.api.post<AlbumRead>('/albums', body);
  }

  getAlbum(albumId: Uuid): Observable<AlbumRead> {
    return this.api.get<AlbumRead>(`/albums/${albumId}`);
  }

  updateAlbum(albumId: Uuid, body: AlbumUpdateDto): Observable<AlbumRead> {
    return this.api.patch<AlbumRead>(`/albums/${albumId}`, body);
  }

  deleteAlbum(albumId: Uuid): Observable<void> {
    return this.api.delete<void>(`/albums/${albumId}`);
  }

  listAlbumMedia(albumId: Uuid, query?: ListAlbumMediaQuery): Observable<MediaCursorPage> {
    return this.api.get<MediaCursorPage>(`/albums/${albumId}/media`, { query });
  }

  addMediaToAlbum(albumId: Uuid, body: AlbumMediaBatchUpdateDto): Observable<BulkResult> {
    return this.api.put<BulkResult>(`/albums/${albumId}/media`, body);
  }

  removeMediaFromAlbum(albumId: Uuid, body: AlbumMediaBatchUpdateDto): Observable<BulkResult> {
    return this.api.delete<BulkResult>(`/albums/${albumId}/media`, { body });
  }

  shareAlbum(albumId: Uuid, body: AlbumShareCreateDto): Observable<AlbumShareRead> {
    return this.api.post<AlbumShareRead>(`/albums/${albumId}/shares`, body);
  }

  revokeShare(albumId: Uuid, sharedUserId: Uuid): Observable<void> {
    return this.api.delete<void>(`/albums/${albumId}/shares/${sharedUserId}`);
  }

  transferOwnership(albumId: Uuid, body: AlbumOwnershipTransferDto): Observable<AlbumRead> {
    return this.api.post<AlbumRead>(`/albums/${albumId}/owner/transfer`, body);
  }

  downloadAlbum(albumId: Uuid): Observable<Blob> {
    return this.api.getBlob(`/albums/${albumId}/download`);
  }
}
