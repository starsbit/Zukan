import { HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  BatchUploadResponse,
  BulkResult,
  CharacterSuggestion,
  DownloadRequestDto,
  ListMediaQuery,
  MediaBatchDeleteDto,
  MediaBatchUpdateDto,
  MediaCursorPage,
  MediaDetail,
  MediaUpdateDto,
  TaggingJobQueuedResponse,
  Uuid
} from '../../models/api';
import { ClientApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class MediaClientService {
  private readonly api = inject(ClientApiService);

  uploadMedia(files: File[]): Observable<BatchUploadResponse> {
    return this.api.post<BatchUploadResponse>('/media', this.buildUploadPayload(files));
  }

  uploadMediaWithProgress(files: File[]): Observable<HttpEvent<BatchUploadResponse>> {
    return this.api.postEvents<BatchUploadResponse>('/media', this.buildUploadPayload(files));
  }

  private buildUploadPayload(files: File[]): FormData {
    const formData = new FormData();

    for (const file of files) {
      formData.append('files', file, file.name);
      if (Number.isFinite(file.lastModified) && file.lastModified > 0) {
        formData.append('captured_at_values', new Date(file.lastModified).toISOString());
      }
    }

    return formData;
  }

  listMedia(query?: ListMediaQuery): Observable<MediaCursorPage> {
    return this.api.get<MediaCursorPage>('/media', { query });
  }

  searchMedia(query?: ListMediaQuery): Observable<MediaCursorPage> {
    return this.api.get<MediaCursorPage>('/media/search', { query });
  }

  listCharacterSuggestions(query: { q: string; limit?: number }): Observable<CharacterSuggestion[]> {
    return this.api.get<CharacterSuggestion[]>('/media/character-suggestions', { query });
  }

  batchUpdateMedia(body: MediaBatchUpdateDto): Observable<BulkResult> {
    return this.api.patch<BulkResult>('/media', body);
  }

  batchDeleteMedia(body: MediaBatchDeleteDto): Observable<BulkResult> {
    return this.api.post<BulkResult>('/media/actions/delete', body);
  }

  emptyTrash(): Observable<void> {
    return this.api.post<void>('/media/actions/empty-trash', null);
  }

  downloadMedia(body: DownloadRequestDto): Observable<Blob> {
    return this.api.postBlob('/media/download', body);
  }

  getMedia(mediaId: Uuid): Observable<MediaDetail> {
    return this.api.get<MediaDetail>(`/media/${mediaId}`);
  }

  updateMedia(mediaId: Uuid, body: MediaUpdateDto): Observable<MediaDetail> {
    return this.api.patch<MediaDetail>(`/media/${mediaId}`, body);
  }

  deleteMedia(mediaId: Uuid): Observable<void> {
    return this.api.delete<void>(`/media/${mediaId}`);
  }

  purgeMedia(mediaId: Uuid): Observable<void> {
    return this.api.delete<void>(`/media/${mediaId}/purge`);
  }

  batchPurgeMedia(body: MediaBatchDeleteDto): Observable<BulkResult> {
    return this.api.post<BulkResult>('/media/actions/purge', body);
  }

  queueTaggingJob(mediaId: Uuid): Observable<TaggingJobQueuedResponse> {
    return this.api.post<TaggingJobQueuedResponse>(`/media/${mediaId}/tagging-jobs`, {});
  }

  getMediaFile(mediaId: Uuid): Observable<Blob> {
    return this.api.getBlob(`/media/${mediaId}/file`);
  }

  getMediaThumbnail(mediaId: Uuid): Observable<Blob> {
    return this.api.getBlob(`/media/${mediaId}/thumbnail`);
  }

  getMediaPoster(mediaId: Uuid): Observable<Blob> {
    return this.api.getBlob(`/media/${mediaId}/poster`);
  }
}
