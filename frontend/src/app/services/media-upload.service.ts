import { HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  BehaviorSubject,
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

import { BatchUploadResponse, MediaDetail, Uuid } from '../models/api';
import { MediaClientService } from './web/media-client.service';

export type UploadPhase = 'idle' | 'selecting' | 'uploading' | 'processing' | 'completed' | 'completed_with_errors' | 'failed';
export type UploadQueueItemState = 'queued' | 'uploading' | 'processing' | 'done' | 'duplicate' | 'error' | 'failed';

export interface UploadQueueItem {
  fileName: string;
  size: number;
  mimeType: string;
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

const AUTO_MINIMIZE_DELAY_MS = 4000;
const POLL_INTERVAL_MS = 2000;

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
  private readonly snackBar = inject(MatSnackBar);

  private readonly sessionSubject = new BehaviorSubject<UploadSession>(createIdleSession());
  private readonly refreshSubject = new Subject<void>();

  private pollSubscription: Subscription | null = null;
  private autoMinimizeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly session$ = this.sessionSubject.asObservable();
  readonly refreshRequested$ = this.refreshSubject.asObservable();

  get snapshot(): UploadSession {
    return this.sessionSubject.value;
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
        status: 'uploading',
        mediaId: null,
        message: null
      })),
      errorMessage: null
    });

    this.mediaClient.uploadMediaWithProgress(uploadFiles).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.Sent) {
          this.patchSession({
            phase: 'uploading',
            uploadProgress: 0
          });
          return;
        }

        if (event.type === HttpEventType.UploadProgress) {
          const total = event.total ?? 0;
          const progress = total > 0 ? Math.round((event.loaded / total) * 100) : null;
          this.patchSession({
            phase: 'uploading',
            uploadProgress: progress
          });
          return;
        }

        if (event.type === HttpEventType.Response && event.body) {
          this.handleUploadResponse(event.body);
        }
      },
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

  dismissSession(): void {
    this.clearTimers();
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

  private handleUploadResponse(response: BatchUploadResponse): void {
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
      switchMap(() => forkJoin(mediaIds.map((mediaId) => this.mediaClient.getMedia(mediaId).pipe(
        catchError(() => of(null))
      )))),
      map((results) => results.filter((result): result is MediaDetail => Boolean(result))),
      tap((mediaItems) => this.patchProcessing(mediaItems, mediaIds.length)),
      filter((mediaItems) => mediaItems.length === mediaIds.length && mediaItems.every((item) => isProcessingSettled(item))),
      take(1)
    ).subscribe(() => {
      this.clearPolling();
      this.refreshSubject.next();
      this.completeSession();
    });
  }

  private patchProcessing(mediaItems: MediaDetail[], totalAccepted: number): void {
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
          message: 'Processing failed'
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
}

function hasProcessingFailed(media: MediaDetail): boolean {
  return getUploadProcessingStatuses(media).some((status) => status === 'failed');
}

function isProcessingSettled(media: MediaDetail): boolean {
  const statuses = getUploadProcessingStatuses(media);

  return statuses.length > 0 && statuses.every((status) => status === 'done' || status === 'failed');
}

function getUploadProcessingStatuses(media: MediaDetail): string[] {
  const statuses = [media.thumbnail_status];

  if (media.media_type !== 'image') {
    statuses.push(media.poster_status ?? 'pending');
  } else if (media.poster_status) {
    statuses.push(media.poster_status);
  }

  return statuses.filter((value): value is string => Boolean(value));
}
