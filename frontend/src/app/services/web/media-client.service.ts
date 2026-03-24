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
  private static readonly SEARCH_QUERY_KEYS: Array<keyof ListMediaQuery> = [
    'tag',
    'character_name',
    'exclude_tag',
    'mode',
    'nsfw',
    'status',
    'favorited',
    'media_type',
    'captured_year',
    'captured_month',
    'captured_day',
    'captured_after',
    'captured_before',
    'captured_before_year',
    'ocr_text'
  ];

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

  listMedia(query?: ListMediaQuery): Observable<MediaCursorPage> {
    const endpoint = this.shouldUseSearchEndpoint(query) ? '/media/search' : '/media';
    return this.api.get<MediaCursorPage>(endpoint, { query });
  }

  private shouldUseSearchEndpoint(query?: ListMediaQuery): boolean {
    if (!query) {
      return false;
    }

    return MediaClientService.SEARCH_QUERY_KEYS.some((key) => this.hasMeaningfulValue(query[key]));
  }

  private hasMeaningfulValue(value: unknown): boolean {
    if (value == null) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    return true;
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

  restoreMedia(mediaId: Uuid): Observable<MediaDetail> {
    return this.updateMedia(mediaId, { deleted: false });
  }

  restoreMediaBatch(mediaIds: Uuid[]): Observable<BulkResult> {
    return this.batchUpdateMedia({ media_ids: mediaIds, deleted: false });
  }

  deleteMedia(mediaId: Uuid): Observable<void> {
    return this.api.delete<void>(`/media/${mediaId}`);
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
