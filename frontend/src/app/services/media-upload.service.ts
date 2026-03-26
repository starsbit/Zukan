import { HttpEventType } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  BehaviorSubject,
  Observable,
  Subject,
  Subscription,
  catchError,
  filter,
  forkJoin,
  map,
  of,
  switchMap,
  take,
  tap,
  timer
} from 'rxjs';

import { BatchUploadResponse, MediaDetail, ProcessingStatus, Uuid } from '../models/api';
import { ConfigClientService } from './web/config-client.service';
import { MediaClientService } from './web/media-client.service';

export type UploadPhase = 'idle' | 'selecting' | 'uploading' | 'processing' | 'completed' | 'completed_with_errors' | 'failed';
export type UploadQueueItemState = 'queued' | 'uploading' | 'processing' | 'done' | 'duplicate' | 'error' | 'failed';

export interface UploadQueueItem {
  fileName: string;
  size: number;
  mimeType: string;
  previewUrl: string | null;
  status: UploadQueueItemState;
  mediaId: Uuid | null;
  message: string | null;
}

export interface UploadSession {
  phase: UploadPhase;
  visible: boolean;
  expanded: boolean;
  active: boolean;
  totalFiles: number;
  uploadProgress: number | null;
  processingProgress: number | null;
  accepted: number;
  duplicates: number;
  errors: number;
  completed: number;
  items: UploadQueueItem[];
  errorMessage: string | null;
}

export interface UploadReviewCandidate {
  media: MediaDetail;
  issue: 'tagging_failed' | 'missing_character';
}

interface AggregatedUploadResponse {
  accepted: number;
  duplicates: number;
  errors: number;
  results: BatchUploadResponse['results'];
}

const AUTO_MINIMIZE_DELAY_MS = 4000;
const POLL_INTERVAL_MS = 2000;
const DEFAULT_UPLOAD_BATCH_SIZE = 100;

function createIdleSession(): UploadSession {
  return {
    phase: 'idle',
    visible: false,
    expanded: true,
    active: false,
    totalFiles: 0,
    uploadProgress: null,
    processingProgress: null,
    accepted: 0,
    duplicates: 0,
    errors: 0,
    completed: 0,
    items: [],
    errorMessage: null
  };
}

@Injectable({
  providedIn: 'root'
})
export class MediaUploadService {
  private readonly mediaClient = inject(MediaClientService);
  private readonly configClient = inject(ConfigClientService);
  private readonly snackBar = inject(MatSnackBar);

  private readonly sessionSubject = new BehaviorSubject<UploadSession>(createIdleSession());
  private readonly refreshSubject = new Subject<void>();
  private readonly reviewSubject = new Subject<UploadReviewCandidate[]>();
  private readonly taggingStatusByMediaId = signal<Partial<Record<Uuid, string>>>({});

  private pollSubscription: Subscription | null = null;
  private autoMinimizeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly session$ = this.sessionSubject.asObservable();
  readonly refreshRequested$ = this.refreshSubject.asObservable();
  readonly reviewRequested$ = this.reviewSubject.asObservable();

  get snapshot(): UploadSession {
    return this.sessionSubject.value;
  }

  getMediaTaggingStatus(mediaId: Uuid | null | undefined): string | null {
    if (!mediaId) {
      return null;
    }

    return this.taggingStatusByMediaId()[mediaId] ?? null;
  }

  startUpload(files: File[]): void {
    const uploadFiles = files.filter((file) => file.size >= 0);

    if (uploadFiles.length === 0) {
      this.openSnackBar('Select at least one file to upload.');
      return;
    }

    if (this.snapshot.active) {
      this.openSnackBar('An upload is already in progress.');
      return;
    }

    this.clearTimers();
    this.clearTaggingStatuses();
    this.releasePreviewUrls(this.snapshot.items);

    this.sessionSubject.next({
      phase: 'uploading',
      visible: true,
      expanded: true,
      active: true,
      totalFiles: uploadFiles.length,
      uploadProgress: 0,
      processingProgress: null,
      accepted: 0,
      duplicates: 0,
      errors: 0,
      completed: 0,
      items: uploadFiles.map((file) => ({
        fileName: file.name,
        size: file.size,
        mimeType: file.type,
        previewUrl: createPreviewUrl(file),
        status: 'uploading',
        mediaId: null,
        message: null
      })),
      errorMessage: null
    });

    this.configClient.getUploadConfig().pipe(
      map((config) => normalizeUploadBatchSize(config.max_batch_size)),
      catchError(() => of(DEFAULT_UPLOAD_BATCH_SIZE)),
      switchMap((batchSize) => this.uploadInBatches(uploadFiles, batchSize))
    ).subscribe({
      next: (response) => this.handleUploadResponse(response),
      error: () => {
        this.clearPolling();
        this.patchSession({
          phase: 'failed',
          visible: true,
          expanded: true,
          active: false,
          uploadProgress: null,
          processingProgress: null,
          errorMessage: 'Upload failed. Please try again.'
        });
        this.openSnackBar('Upload failed. Please try again.');
      }
    });
  }

  private uploadInBatches(files: File[], batchSize: number): Observable<AggregatedUploadResponse> {
    const normalizedBatchSize = normalizeUploadBatchSize(batchSize);
    const batches = chunkFiles(files, normalizedBatchSize);
    const totalBytes = files.reduce((sum, file) => sum + Math.max(0, file.size), 0);

    return new Observable<AggregatedUploadResponse>((subscriber) => {
      let currentSubscription: Subscription | null = null;
      let batchIndex = 0;
      let uploadedBytes = 0;
      const aggregate: AggregatedUploadResponse = {
        accepted: 0,
        duplicates: 0,
        errors: 0,
        results: []
      };

      const runNextBatch = () => {
        if (batchIndex >= batches.length) {
          subscriber.next(aggregate);
          subscriber.complete();
          return;
        }

        const currentBatch = batches[batchIndex] ?? [];
        const currentBatchBytes = currentBatch.reduce((sum, file) => sum + Math.max(0, file.size), 0);

        currentSubscription = this.mediaClient.uploadMediaWithProgress(currentBatch).subscribe({
          next: (event) => {
            if (event.type === HttpEventType.Sent) {
              this.patchSession({
                phase: 'uploading',
                uploadProgress: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0
              });
              return;
            }

            if (event.type === HttpEventType.UploadProgress) {
              const totalForEvent = event.total ?? currentBatchBytes;
              const fraction = totalForEvent > 0 ? Math.min(1, event.loaded / totalForEvent) : 0;
              const currentUploadedBytes = uploadedBytes + (fraction * currentBatchBytes);
              this.patchSession({
                phase: 'uploading',
                uploadProgress: totalBytes > 0 ? Math.round((currentUploadedBytes / totalBytes) * 100) : null
              });
              return;
            }

            if (event.type === HttpEventType.Response && event.body) {
              aggregate.accepted += event.body.accepted;
              aggregate.duplicates += event.body.duplicates;
              aggregate.errors += event.body.errors;
              aggregate.results.push(...event.body.results);

              uploadedBytes += currentBatchBytes;
              this.patchSession({
                phase: 'uploading',
                uploadProgress: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 100
              });

              batchIndex += 1;
              runNextBatch();
            }
          },
          error: (error) => subscriber.error(error)
        });
      };

      runNextBatch();

      return () => {
        currentSubscription?.unsubscribe();
      };
    });
  }

  dismissSession(): void {
    this.clearTimers();
    this.clearTaggingStatuses();
    this.releasePreviewUrls(this.snapshot.items);
    this.sessionSubject.next(createIdleSession());
  }

  expand(): void {
    this.clearAutoMinimizeTimer();
    this.patchSession({ visible: true, expanded: true });
  }

  collapse(): void {
    this.clearAutoMinimizeTimer();
    this.patchSession({ expanded: false });
  }

  toggleExpanded(): void {
    this.patchSession({ expanded: !this.snapshot.expanded, visible: true });
  }

  private handleUploadResponse(response: AggregatedUploadResponse): void {
    const items: UploadQueueItem[] = this.snapshot.items.map((item, index) => {
      const result = response.results[index];

      if (!result) {
        return item;
      }

      if (result.status === 'accepted') {
        return {
          ...item,
          mediaId: result.id,
          message: result.message ?? null,
          status: 'processing'
        };
      }

      if (result.status === 'duplicate') {
        return {
          ...item,
          mediaId: result.id,
          message: result.message ?? 'Already uploaded',
          status: 'duplicate'
        };
      }

      return {
        ...item,
        mediaId: result.id,
        message: result.message ?? 'Upload failed',
        status: 'error'
      };
    });

    const acceptedIds = items
      .filter((item) => item.status === 'processing' && item.mediaId)
      .map((item) => item.mediaId as Uuid);

    const nextPhase = acceptedIds.length > 0
      ? 'processing'
      : response.errors > 0 || response.duplicates > 0
        ? 'completed_with_errors'
        : 'completed';

    this.sessionSubject.next({
      ...this.snapshot,
      phase: nextPhase,
      visible: true,
      expanded: true,
      active: acceptedIds.length > 0,
      uploadProgress: 100,
      processingProgress: acceptedIds.length > 0 ? 0 : 100,
      accepted: response.accepted,
      duplicates: response.duplicates,
      errors: response.errors,
      completed: acceptedIds.length > 0 ? 0 : response.accepted,
      items,
      errorMessage: null
    });

    this.patchTaggingStatuses(
      items
        .filter((item) => item.status === 'processing' && item.mediaId)
        .map((item) => ({ mediaId: item.mediaId as Uuid, taggingStatus: 'pending' }))
    );

    this.refreshSubject.next();

    if (acceptedIds.length === 0) {
      this.completeSession();
      return;
    }

    this.startPolling(acceptedIds);
  }

  private startPolling(mediaIds: Uuid[]): void {
    this.clearPolling();

    this.pollSubscription = timer(0, POLL_INTERVAL_MS).pipe(
      switchMap(() => forkJoin(mediaIds.map((mediaId) => this.loadUploadMedia(mediaId)))),
      map((results) => results.filter((result): result is MediaDetail => Boolean(result))),
      tap((mediaItems) => this.patchProcessing(mediaItems, mediaIds.length)),
      filter((mediaItems) => mediaItems.length === mediaIds.length && mediaItems.every((item) => isProcessingSettled(item))),
      take(1)
    ).subscribe((mediaItems) => {
      this.clearPolling();
      this.emitReviewCandidates(mediaItems);
      this.completeSession();
    });
  }

  private patchProcessing(mediaItems: MediaDetail[], totalAccepted: number): void {
    const previousStatuses = new Map(
      this.snapshot.items
        .filter((item) => item.mediaId)
        .map((item) => [item.mediaId as Uuid, item.status])
    );

    const detailsById = new Map(mediaItems.map((item) => [item.id, item]));
    const items: UploadQueueItem[] = this.snapshot.items.map((item) => {
      if (!item.mediaId) {
        return item;
      }

      const media = detailsById.get(item.mediaId);
      if (!media) {
        return item;
      }

      if (hasProcessingFailed(media)) {
        return {
          ...item,
          status: 'failed',
          message: media.tagging_error ?? 'Processing failed'
        };
      }

      if (isProcessingSettled(media)) {
        return {
          ...item,
          status: 'done',
          message: null
        };
      }

      return {
        ...item,
        status: 'processing',
        message: null
      };
    });

    const completed = items.filter((item) => item.mediaId && (item.status === 'done' || item.status === 'failed')).length;
    const normalizedCompleted = Math.max(0, Math.min(totalAccepted, completed));
    const hasFailures = items.some((item) => item.status === 'failed' || item.status === 'error');

    this.patchSession({
      phase: normalizedCompleted < totalAccepted ? 'processing' : hasFailures ? 'completed_with_errors' : 'processing',
      active: normalizedCompleted < totalAccepted,
      processingProgress: totalAccepted > 0 ? Math.round((normalizedCompleted / totalAccepted) * 100) : 100,
      completed: normalizedCompleted,
      items
    });

    const hasNewlySettledMedia = items.some((item) => {
      if (!item.mediaId) {
        return false;
      }

      return item.status === 'done' && previousStatuses.get(item.mediaId) !== 'done';
    });

    if (hasNewlySettledMedia) {
      this.refreshSubject.next();
    }

    this.patchTaggingStatuses(
      mediaItems.map((media) => ({ mediaId: media.id, taggingStatus: media.tagging_status }))
    );
  }

  private completeSession(): void {
    const hasErrors = this.snapshot.errors > 0
      || this.snapshot.duplicates > 0
      || this.snapshot.items.some((item) => item.status === 'failed' || item.status === 'error');

    this.patchSession({
      phase: hasErrors ? 'completed_with_errors' : 'completed',
      active: false,
      uploadProgress: this.snapshot.uploadProgress ?? 100,
      processingProgress: this.snapshot.processingProgress ?? 100,
      completed: this.snapshot.accepted
    });

    if (!hasErrors) {
      this.scheduleAutoMinimize();
    }
  }

  private emitReviewCandidates(mediaItems: MediaDetail[]): void {
    const reviewCandidates: UploadReviewCandidate[] = mediaItems.flatMap((media): UploadReviewCandidate[] => {
      if (media.tagging_status === 'failed') {
        return [{ media, issue: 'tagging_failed' as const }];
      }

      if (media.media_type === 'image' && media.tagging_status === 'done' && !media.entities?.some(e => e.entity_type === 'character')) {
        return [{ media, issue: 'missing_character' as const }];
      }

      return [];
    });

    if (reviewCandidates.length > 0) {
      this.reviewSubject.next(reviewCandidates);
    }
  }

  private loadUploadMedia(mediaId: Uuid) {
    return this.mediaClient.getMedia(mediaId).pipe(
      catchError(() => this.mediaClient.listMedia({
        page_size: 200,
        nsfw: 'include'
      }).pipe(
        map((page) => page.items.find((item) => item.id === mediaId) as MediaDetail | null),
        catchError(() => of(null))
      ))
    );
  }

  private scheduleAutoMinimize(): void {
    this.clearAutoMinimizeTimer();
    this.autoMinimizeTimer = setTimeout(() => {
      this.patchSession({ expanded: false });
    }, AUTO_MINIMIZE_DELAY_MS);
  }

  private patchSession(patch: Partial<UploadSession>): void {
    this.sessionSubject.next({
      ...this.snapshot,
      ...patch
    });
  }

  private clearTimers(): void {
    this.clearPolling();
    this.clearAutoMinimizeTimer();
  }

  private clearPolling(): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = null;
  }

  private clearAutoMinimizeTimer(): void {
    if (!this.autoMinimizeTimer) {
      return;
    }

    clearTimeout(this.autoMinimizeTimer);
    this.autoMinimizeTimer = null;
  }

  private openSnackBar(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000
    });
  }

  private patchTaggingStatuses(items: Array<{ mediaId: Uuid; taggingStatus: string }>): void {
    if (items.length === 0) {
      return;
    }

    const nextStatuses = { ...this.taggingStatusByMediaId() };

    for (const item of items) {
      nextStatuses[item.mediaId] = item.taggingStatus;
    }

    this.taggingStatusByMediaId.set(nextStatuses);
  }

  private clearTaggingStatuses(): void {
    this.taggingStatusByMediaId.set({});
  }

  private releasePreviewUrls(items: UploadQueueItem[]): void {
    if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
      return;
    }

    for (const item of items) {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
  }
}

function hasProcessingFailed(media: MediaDetail): boolean {
  return getUploadProcessingStatuses(media).some((status) => status === 'failed');
}

function isProcessingSettled(media: MediaDetail): boolean {
  const statuses = getUploadProcessingStatuses(media);

  return statuses.length > 0 && statuses.every((status) => status === 'done' || status === 'failed');
}

function getUploadProcessingStatuses(media: MediaDetail): ProcessingStatus[] {
  const statuses = [media.tagging_status, media.thumbnail_status];

  if (media.media_type !== 'image') {
    statuses.push(media.poster_status ?? 'pending');
  } else if (media.poster_status) {
    statuses.push(media.poster_status);
  }

  return statuses.filter((value): value is ProcessingStatus => Boolean(value));
}

function normalizeUploadBatchSize(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return DEFAULT_UPLOAD_BATCH_SIZE;
  }

  return Math.floor(value);
}

function chunkFiles(files: File[], chunkSize: number): File[][] {
  const chunks: File[][] = [];
  for (let index = 0; index < files.length; index += chunkSize) {
    chunks.push(files.slice(index, index + chunkSize));
  }
  return chunks;
}

function createPreviewUrl(file: File): string | null {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return null;
  }

  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}
