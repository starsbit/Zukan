import { inject, Injectable, OnDestroy, computed, signal } from '@angular/core';
import { EMPTY, Subject, Subscription, catchError, concatMap, expand, forkJoin, reduce, tap } from 'rxjs';
import { MediaRead, MediaVisibility, TaggingStatus } from '../models/media';
import {
  ImportBatchItemListResponse,
  ImportBatchItemRead,
  ImportBatchRead,
  ImportBatchReviewItemRead,
} from '../models/processing';
import {
  UploadStatusDialogItem,
  UploadStatusFilter,
  UploadStatusSummary,
  batchItemFilter,
  batchItemStatusLabel,
  filterLabel,
  isTerminalBatchStatus,
  processingStepLabel,
  taggingStatusFilter,
  taggingStatusLabel,
} from '../models/upload-tracker';
import { BatchUploadResponse } from '../models/uploads';
import { GalleryStore } from './gallery.store';
import { MediaService } from './media.service';
import { BatchesClientService } from './web/batches-client.service';

const DEFAULT_POLL_AFTER_SECONDS = 3;
const ITEMS_PAGE_SIZE = 200;

interface UploadPendingRequest {
  id: string;
  visibility: MediaVisibility;
  fileNames: string[];
  state: 'queued' | 'uploading' | 'completed' | 'failed';
  createdAt: string;
  error: string | null;
}

interface TrackedBatchState {
  id: string;
  visibility: MediaVisibility;
  createdAt: string;
  pollAfterSeconds: number;
  requestId: string;
  response: BatchUploadResponse;
  batch: ImportBatchRead | null;
  items: ImportBatchItemRead[];
  reviewItems: ImportBatchReviewItemRead[];
  reviewTotal: number;
  reviewBaselineTotal: number;
  reviewRefreshing: boolean;
  error: string | null;
  refreshing: boolean;
}

interface FailedUploadFile {
  id: string;
  filename: string;
  error: string | null;
  requestId: string;
  createdAt: string;
}

interface TrackedMediaState {
  id: string;
  filename: string;
  taggingStatus: TaggingStatus;
  error: string | null;
  updatedAt: string;
  refreshing: boolean;
}

@Injectable({ providedIn: 'root' })
export class UploadTrackerService implements OnDestroy {
  private readonly batchesClient = inject(BatchesClientService);
  private readonly galleryStore = inject(GalleryStore);
  private readonly mediaService = inject(MediaService);

  private readonly pendingRequests = signal<UploadPendingRequest[]>([]);
  private readonly trackedBatches = signal<Record<string, TrackedBatchState>>({});
  private readonly failedUploadFiles = signal<FailedUploadFile[]>([]);
  private readonly trackedMedia = signal<Record<string, TrackedMediaState>>({});
  private readonly dismissed = signal(false);

  private readonly pollTimers = new Map<string, number>();
  private readonly refreshSubscriptions = new Map<string, Subscription>();
  private readonly mediaPollTimers = new Map<string, number>();
  private readonly mediaPollSubscriptions = new Map<string, Subscription>();
  private readonly resolvedMediaIds = new Set<string>();
  private readonly mediaRefreshQueue = new Subject<string>();
  private readonly mediaRefreshSubscription: Subscription;
  private nextRequestId = 0;
  private nextErrorId = 0;

  constructor() {
    this.mediaRefreshSubscription = this.mediaRefreshQueue.pipe(
      concatMap((mediaId) => this.mediaService.get(mediaId).pipe(
        tap((media) => this.galleryStore.patchItem(media)),
        catchError(() => EMPTY),
      )),
    ).subscribe();
  }

  readonly itemsByFilter = computed<Record<UploadStatusFilter, UploadStatusDialogItem[]>>(() => {
    const grouped: Record<UploadStatusFilter, UploadStatusDialogItem[]> = {
      pending: [],
      processing: [],
      done: [],
      failed: [],
      skipped: [],
      duplicate: [],
      upload_error: [],
    };

    for (const batch of Object.values(this.trackedBatches())) {
      for (const item of batch.items) {
        const filter = batchItemFilter(item.status);
        grouped[filter].push({
          id: item.id,
          filter,
          filename: item.source_filename,
          error: item.error,
          previewMediaId: item.media_id,
          batchId: item.batch_id,
          statusLabel: batchItemStatusLabel(item.status),
          stepLabel: processingStepLabel(item.step),
          progressPercent: item.progress_percent,
          updatedAt: item.updated_at,
        });
      }

      for (const result of batch.response.results) {
        const resultTimestamp = batch.batch?.last_heartbeat_at
          ?? batch.batch?.finished_at
          ?? batch.batch?.started_at
          ?? batch.batch?.created_at
          ?? batch.createdAt;

        if (result.status === 'duplicate') {
          grouped.duplicate.push({
            id: `duplicate:${batch.id}:${result.batch_item_id ?? result.original_filename}`,
            filter: 'duplicate',
            filename: result.original_filename,
            error: result.message,
            previewMediaId: result.id,
            batchId: batch.id,
            statusLabel: 'Duplicate',
            stepLabel: null,
            progressPercent: null,
            updatedAt: resultTimestamp,
          });
        }

        if (result.status === 'error') {
          grouped.upload_error.push({
            id: `upload-error:${batch.id}:${result.batch_item_id ?? result.original_filename}`,
            filter: 'upload_error',
            filename: result.original_filename,
            error: result.message,
            previewMediaId: null,
            batchId: batch.id,
            statusLabel: 'Upload error',
            stepLabel: null,
            progressPercent: null,
            updatedAt: resultTimestamp,
          });
        }
      }
    }

    for (const media of Object.values(this.trackedMedia())) {
      grouped[taggingStatusFilter(media.taggingStatus)].push({
        id: `media:${media.id}`,
        filter: taggingStatusFilter(media.taggingStatus),
        filename: media.filename,
        error: media.error,
        previewMediaId: media.id,
        batchId: null,
        statusLabel: taggingStatusLabel(media.taggingStatus),
        stepLabel: 'Tagging',
        progressPercent: null,
        updatedAt: media.updatedAt,
      });
    }

    for (const failed of this.failedUploadFiles()) {
      grouped.upload_error.push({
        id: failed.id,
        filter: 'upload_error',
        filename: failed.filename,
        error: failed.error,
        previewMediaId: null,
        batchId: null,
        statusLabel: 'Upload error',
        stepLabel: null,
        progressPercent: null,
        updatedAt: failed.createdAt,
      });
    }

    for (const filter of Object.keys(grouped) as UploadStatusFilter[]) {
      grouped[filter] = grouped[filter]
        .slice()
        .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
    }

    return grouped;
  });

  readonly hasTrackedUploads = computed(() =>
    this.pendingRequests().length > 0
    || Object.keys(this.trackedBatches()).length > 0
    || Object.keys(this.trackedMedia()).length > 0
    || this.failedUploadFiles().length > 0,
  );

  readonly hasActiveWork = computed(() => {
    const requestCounts = this.pendingRequests();
    if (requestCounts.some((request) => request.state === 'queued' || request.state === 'uploading')) {
      return true;
    }

    return Object.values(this.trackedBatches()).some((batch) => {
      if (batch.refreshing || batch.batch === null) {
        return true;
      }

      return !isTerminalBatchStatus(batch.batch.status);
    }) || Object.values(this.trackedMedia()).some((media) =>
      media.refreshing
      || media.taggingStatus === TaggingStatus.PENDING
      || media.taggingStatus === TaggingStatus.PROCESSING,
    );
  });

  readonly visible = computed(() => this.hasTrackedUploads() && (!this.dismissed() || this.hasActiveWork()));
  readonly reviewBatches = computed(() =>
    Object.values(this.trackedBatches())
      .filter((batch) => batch.reviewItems.length > 0 || batch.reviewBaselineTotal > 0)
      .slice()
      .sort((left, right) => {
        const rightTimestamp = right.batch?.created_at ?? right.createdAt;
        const leftTimestamp = left.batch?.created_at ?? left.createdAt;
        return rightTimestamp.localeCompare(leftTimestamp);
      }),
  );

  readonly summary = computed<UploadStatusSummary>(() => {
    const mutableRequestCounts: Record<'queued' | 'uploading' | 'completed' | 'failed', number> = {
      queued: 0,
      uploading: 0,
      completed: 0,
      failed: 0,
    };
    for (const request of this.pendingRequests()) {
      mutableRequestCounts[request.state] += 1;
    }

    const itemCounts: Record<UploadStatusFilter, number> = {
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      duplicate: 0,
      upload_error: 0,
    };

    let latestBatch: ImportBatchRead | null = null;
    let latestBatchTimestamp = '';
    for (const batch of Object.values(this.trackedBatches())) {
      const candidateTimestamp = batch.batch?.created_at ?? batch.createdAt;
      if (batch.batch && candidateTimestamp >= latestBatchTimestamp) {
        latestBatch = batch.batch;
        latestBatchTimestamp = candidateTimestamp;
      }

      if (batch.batch) {
        itemCounts.pending += batch.batch.queued_items;
        itemCounts.processing += batch.batch.processing_items;
        itemCounts.done += batch.batch.done_items;
        itemCounts.failed += batch.batch.failed_items;
      }

      itemCounts.duplicate += batch.response.duplicates;
      itemCounts.upload_error += batch.response.errors;
    }

    for (const media of Object.values(this.trackedMedia())) {
      itemCounts[taggingStatusFilter(media.taggingStatus)] += 1;
    }

    itemCounts.skipped = this.itemsByFilter().skipped.length;
    itemCounts.upload_error += this.failedUploadFiles().length;

    const reviewItems = Object.values(this.trackedBatches()).reduce((sum, batch) => sum + batch.reviewItems.length, 0);
    const totalTrackedItems = Object.values(itemCounts).reduce((sum, count) => sum + count, 0);
    const completedItems = itemCounts.done + itemCounts.failed + itemCounts.skipped + itemCounts.duplicate + itemCounts.upload_error;
    const progressPercent = totalTrackedItems > 0
      ? Math.round((completedItems / totalTrackedItems) * 100)
      : 0;

    return {
      requestCounts: mutableRequestCounts,
      itemCounts,
      reviewItems,
      reviewBatchCount: this.reviewBatches().length,
      latestReviewBatchId: this.reviewBatches()[0]?.id ?? null,
      totalTrackedItems,
      completedItems,
      progressPercent,
      activeBatchCount: Object.values(this.trackedBatches()).filter((batch) =>
        batch.batch === null || !isTerminalBatchStatus(batch.batch.status),
      ).length,
      hasActiveWork: this.hasActiveWork(),
      latestBatch,
    };
  });

  readonly countChips = computed(() =>
    (Object.keys(this.summary().itemCounts) as UploadStatusFilter[])
      .map((filter) => ({
        filter,
        label: filterLabel(filter),
        count: this.summary().itemCounts[filter],
      }))
      .filter((item) => item.count > 0),
  );

  getBatchReview(batchId: string): TrackedBatchState | null {
    return this.trackedBatches()[batchId] ?? null;
  }

  registerPendingBatch(files: File[], visibility: MediaVisibility): string {
    const requestId = `request-${this.nextRequestId += 1}`;
    this.dismissed.set(false);
    this.pendingRequests.update((requests) => [
      ...requests,
      {
        id: requestId,
        visibility,
        fileNames: files.map((file) => file.name),
        state: 'queued',
        createdAt: new Date().toISOString(),
        error: null,
      },
    ]);
    return requestId;
  }

  markBatchUploading(requestId: string): void {
    this.pendingRequests.update((requests) => requests.map((request) =>
      request.id === requestId ? { ...request, state: 'uploading' } : request,
    ));
  }

  registerBatchStarted(
    requestId: string,
    response: BatchUploadResponse,
    files: File[],
    visibility: MediaVisibility,
  ): void {
    const now = new Date().toISOString();
    this.dismissed.set(false);
    this.pendingRequests.update((requests) => requests.map((request) =>
      request.id === requestId ? { ...request, state: 'completed', error: null } : request,
    ));
    this.trackedBatches.update((current) => ({
      ...current,
      [response.batch_id]: {
        id: response.batch_id,
        visibility,
        createdAt: now,
        pollAfterSeconds: this.normalizePollAfter(response.poll_after_seconds),
        requestId,
        response: {
          ...response,
          results: response.results.length > 0
            ? response.results
            : files.map((file) => ({
              id: null,
              batch_item_id: null,
              original_filename: file.name,
              status: 'accepted' as const,
              message: null,
            })),
        },
        batch: null,
        items: [],
        reviewItems: [],
        reviewTotal: 0,
        reviewBaselineTotal: 0,
        reviewRefreshing: false,
        error: null,
        refreshing: false,
      },
    }));
    const acceptedResults = (response.results.length > 0
      ? response.results
      : files.map((file) => ({
        id: null,
        batch_item_id: null,
        original_filename: file.name,
        status: 'accepted' as const,
        message: null,
      })))
      .filter((result) => result.status === 'accepted');
    const pendingFiles = [...files];
    const acceptedFiles = acceptedResults.map((result) => {
      const matchIndex = pendingFiles.findIndex((file) => file.name === result.original_filename);
      const index = matchIndex >= 0 ? matchIndex : 0;
      return pendingFiles.splice(index, 1)[0];
    }).filter((file): file is File => !!file);
    this.galleryStore.addAcceptedUploads(
      acceptedFiles,
      visibility,
      response.batch_id,
      acceptedResults.map((result) => result.id),
    );
    this.refreshBatch(response.batch_id);
  }

  registerBatchRequestFailed(requestId: string, files: File[], error: string): void {
    const createdAt = new Date().toISOString();
    this.dismissed.set(false);
    this.pendingRequests.update((requests) => requests.map((request) =>
      request.id === requestId ? { ...request, state: 'failed', error } : request,
    ));
    this.failedUploadFiles.update((entries) => [
      ...entries,
      ...files.map((file) => ({
        id: `failed-file-${this.nextErrorId += 1}`,
        filename: file.name,
        error,
        requestId,
        createdAt,
        })),
    ]);
  }

  registerRejectedFiles(files: File[], error: string): void {
    if (files.length === 0) {
      return;
    }

    const createdAt = new Date().toISOString();
    this.dismissed.set(false);
    this.failedUploadFiles.update((entries) => [
      ...entries,
      ...files.map((file) => ({
        id: `failed-file-${this.nextErrorId += 1}`,
        filename: file.name,
        error,
        requestId: 'selection-rejected',
        createdAt,
      })),
    ]);
  }

  dismiss(): void {
    this.dismissed.set(true);
  }

  refreshBatchReview(batchId: string): void {
    const batch = this.trackedBatches()[batchId];
    if (!batch || batch.reviewRefreshing) {
      return;
    }

    this.patchBatch(batchId, { reviewRefreshing: true });
    this.batchesClient.listReviewItems(batchId).subscribe({
      next: (response) => {
        const previousBaseline = this.trackedBatches()[batchId]?.reviewBaselineTotal ?? 0;
        this.patchBatch(batchId, {
          reviewItems: response.items,
          reviewTotal: response.total,
          reviewBaselineTotal: Math.max(previousBaseline, response.total),
          reviewRefreshing: false,
        });
      },
      error: () => {
        this.patchBatch(batchId, { reviewRefreshing: false });
      },
    });
  }

  reset(): void {
    for (const timerId of this.pollTimers.values()) {
      clearTimeout(timerId);
    }
    for (const subscription of this.refreshSubscriptions.values()) {
      subscription.unsubscribe();
    }
    for (const timerId of this.mediaPollTimers.values()) {
      clearTimeout(timerId);
    }
    for (const subscription of this.mediaPollSubscriptions.values()) {
      subscription.unsubscribe();
    }

    this.pollTimers.clear();
    this.refreshSubscriptions.clear();
    this.mediaPollTimers.clear();
    this.mediaPollSubscriptions.clear();
    this.resolvedMediaIds.clear();
    this.galleryStore.clearOptimisticItems();
    this.pendingRequests.set([]);
    this.trackedBatches.set({});
    this.failedUploadFiles.set([]);
    this.trackedMedia.set({});
    this.dismissed.set(false);
  }

  registerRetagging(mediaItems: MediaRead[]): void {
    if (mediaItems.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    this.dismissed.set(false);
    this.trackedMedia.update((entries) => ({
      ...entries,
      ...Object.fromEntries(mediaItems.map((media) => [
        media.id,
        {
          id: media.id,
          filename: media.original_filename ?? media.filename,
          taggingStatus: TaggingStatus.PENDING,
          error: null,
          updatedAt: now,
          refreshing: false,
        } satisfies TrackedMediaState,
      ])),
    }));

    mediaItems.forEach((media) => this.refreshTrackedMedia(media.id));
  }

  ngOnDestroy(): void {
    this.reset();
    this.mediaRefreshSubscription.unsubscribe();
  }

  private refreshBatch(batchId: string): void {
    const batch = this.trackedBatches()[batchId];
    if (!batch || batch.refreshing) {
      return;
    }

    this.clearTimer(batchId);
    this.patchBatch(batchId, { refreshing: true, error: null });

    const subscription = forkJoin({
      batch: this.batchesClient.get(batchId),
      items: this.loadAllBatchItems(batchId),
    }).subscribe({
      next: ({ batch: batchRead, items }) => {
        const previousItems = this.trackedBatches()[batchId]?.items ?? [];
        this.patchBatch(batchId, {
          batch: batchRead,
          items,
          refreshing: false,
          error: null,
        });
        this.queueResolvedMedia(previousItems, items);
        this.refreshBatchReview(batchId);

        if (!isTerminalBatchStatus(batchRead.status)) {
          this.scheduleRefresh(batchId, this.trackedBatches()[batchId]?.pollAfterSeconds ?? DEFAULT_POLL_AFTER_SECONDS);
        }
      },
      error: (err: { error?: { detail?: string } }) => {
        const message = err.error?.detail ?? 'Unable to refresh upload status.';
        this.patchBatch(batchId, { refreshing: false, error: message });
        this.scheduleRefresh(batchId, this.trackedBatches()[batchId]?.pollAfterSeconds ?? DEFAULT_POLL_AFTER_SECONDS);
      },
    });

    this.refreshSubscriptions.get(batchId)?.unsubscribe();
    this.refreshSubscriptions.set(batchId, subscription);
  }

  private loadAllBatchItems(batchId: string) {
    return this.batchesClient.listItems(batchId, { page_size: ITEMS_PAGE_SIZE }).pipe(
      expand((page: ImportBatchItemListResponse) => {
        if (!page.has_more || !page.next_cursor) {
          return EMPTY;
        }

        return this.batchesClient.listItems(batchId, {
          after: page.next_cursor,
          page_size: ITEMS_PAGE_SIZE,
        });
      }),
      reduce((items, page) => [...items, ...page.items], [] as ImportBatchItemRead[]),
    );
  }

  private queueResolvedMedia(previousItems: ImportBatchItemRead[], nextItems: ImportBatchItemRead[]): void {
    const previousById = new Map(previousItems.map((item) => [item.id, item.status]));

    for (const item of nextItems) {
      if (item.status !== 'done' || !item.media_id) {
        continue;
      }

      if (previousById.get(item.id) === 'done' || this.resolvedMediaIds.has(item.media_id)) {
        continue;
      }

      this.galleryStore.resolveOptimisticMediaId(item.batch_id, item.source_filename, item.media_id);
      this.resolvedMediaIds.add(item.media_id);
      this.mediaRefreshQueue.next(item.media_id);
    }
  }

  private scheduleRefresh(batchId: string, pollAfterSeconds: number): void {
    this.clearTimer(batchId);
    const timerId = window.setTimeout(
      () => this.refreshBatch(batchId),
      pollAfterSeconds * 1000,
    );
    this.pollTimers.set(batchId, timerId);
  }

  private clearTimer(batchId: string): void {
    const timerId = this.pollTimers.get(batchId);
    if (timerId != null) {
      clearTimeout(timerId);
      this.pollTimers.delete(batchId);
    }
  }

  private refreshTrackedMedia(mediaId: string): void {
    const media = this.trackedMedia()[mediaId];
    if (!media || media.refreshing) {
      return;
    }

    this.clearMediaTimer(mediaId);
    this.patchTrackedMedia(mediaId, { refreshing: true });

    const subscription = this.mediaService.get(mediaId).subscribe({
      next: (updatedMedia) => {
        this.galleryStore.patchItem(updatedMedia);
        this.patchTrackedMedia(mediaId, {
          filename: updatedMedia.original_filename ?? updatedMedia.filename,
          taggingStatus: updatedMedia.tagging_status,
          error: updatedMedia.tagging_error,
          updatedAt: new Date().toISOString(),
          refreshing: false,
        });

        if (
          updatedMedia.tagging_status === TaggingStatus.PENDING
          || updatedMedia.tagging_status === TaggingStatus.PROCESSING
        ) {
          this.scheduleTrackedMediaRefresh(mediaId, DEFAULT_POLL_AFTER_SECONDS);
        }
      },
      error: () => {
        this.patchTrackedMedia(mediaId, { refreshing: false });
        this.scheduleTrackedMediaRefresh(mediaId, DEFAULT_POLL_AFTER_SECONDS);
      },
    });

    this.mediaPollSubscriptions.get(mediaId)?.unsubscribe();
    this.mediaPollSubscriptions.set(mediaId, subscription);
  }

  private scheduleTrackedMediaRefresh(mediaId: string, pollAfterSeconds: number): void {
    this.clearMediaTimer(mediaId);
    const timerId = window.setTimeout(
      () => this.refreshTrackedMedia(mediaId),
      pollAfterSeconds * 1000,
    );
    this.mediaPollTimers.set(mediaId, timerId);
  }

  private clearMediaTimer(mediaId: string): void {
    const timerId = this.mediaPollTimers.get(mediaId);
    if (timerId != null) {
      clearTimeout(timerId);
      this.mediaPollTimers.delete(mediaId);
    }
  }

  private patchTrackedMedia(mediaId: string, patch: Partial<TrackedMediaState>): void {
    this.trackedMedia.update((current) => {
      const existing = current[mediaId];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [mediaId]: {
          ...existing,
          ...patch,
        },
      };
    });
  }

  private patchBatch(batchId: string, patch: Partial<TrackedBatchState>): void {
    this.trackedBatches.update((current) => {
      const existing = current[batchId];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [batchId]: {
          ...existing,
          ...patch,
        },
      };
    });
  }

  private normalizePollAfter(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return DEFAULT_POLL_AFTER_SECONDS;
    }

    return Math.max(1, Math.round(value));
  }
}
