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
  MediaDetail,
  MediaListResponse,
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
    }

    return formData;
  }

  listMedia(query?: ListMediaQuery): Observable<MediaListResponse> {
    return this.api.get<MediaListResponse>('/media', { query });
  }

  listCharacterSuggestions(query: { q: string; limit?: number }): Observable<CharacterSuggestion[]> {
    return this.api.get<CharacterSuggestion[]>('/media/character-suggestions', { query });
  }

  batchUpdateMedia(body: MediaBatchUpdateDto): Observable<BulkResult> {
    return this.api.patch<BulkResult>('/media', body);
  }

  batchDeleteMedia(body: MediaBatchDeleteDto): Observable<BulkResult> {
    return this.api.delete<BulkResult>('/media', { body });
  }

  emptyTrash(): Observable<void> {
    return this.api.deleteVoid('/media/trash');
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
    return this.api.deleteVoid(`/media/${mediaId}`);
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
}
