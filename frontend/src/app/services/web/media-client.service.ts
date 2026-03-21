import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  BatchUploadResponse,
  BulkResult,
  DownloadRequestDto,
  ListMediaQuery,
  MediaBatchDeleteDto,
  MediaBatchUpdateDto,
  MediaDetail,
  MediaListResponse,
  MediaUpdateDto,
  TaggingJobQueuedResponse,
  Uuid
} from './api-models';
import { ClientApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class MediaClientService {
  private readonly api = inject(ClientApiService);

  uploadMedia(files: File[]): Observable<BatchUploadResponse> {
    const formData = new FormData();

    for (const file of files) {
      formData.append('files', file, file.name);
    }

    return this.api.post<BatchUploadResponse>('/media', formData);
  }

  listMedia(query?: ListMediaQuery): Observable<MediaListResponse> {
    return this.api.get<MediaListResponse>('/media', { query });
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
