import { Injectable, inject } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { NotificationRead, NotificationType } from '../models/notifications';
import { BatchType } from '../models/processing';
import { UserStore } from './user.store';
import { LOCAL_STORAGE } from './web/auth.store';
import { BatchesClientService } from './web/batches-client.service';

const DISMISSALS_KEY = 'zukan_metadata_review_dismissals';
const BATCH_SCAN_LIMIT = 10;

@Injectable({ providedIn: 'root' })
export class ReviewReminderService {
  private readonly storage = inject(LOCAL_STORAGE);
  private readonly userStore = inject(UserStore);
  private readonly batchesClient = inject(BatchesClientService);

  loadReminder(): Observable<NotificationRead | null> {
    const user = this.userStore.currentUser();
    if (!user) {
      return of(null);
    }

    return this.batchesClient.list({ page_size: BATCH_SCAN_LIMIT }).pipe(
      map((response) => response.items.filter((batch) => batch.type === BatchType.UPLOAD).slice(0, BATCH_SCAN_LIMIT)),
      catchError(() => of([])),
      switchMap((batches) => {
        if (batches.length === 0) {
          return of(null);
        }

        return forkJoin(
          batches.map((batch) =>
            this.batchesClient.listReviewItems(batch.id).pipe(
              map((response) => ({ batchId: batch.id, createdAt: batch.created_at, total: response.total })),
              catchError(() => of({ batchId: batch.id, createdAt: batch.created_at, total: 0 })),
            ),
          ),
        ).pipe(
          map((results) => this.buildReminder(user.id, results.filter((result) => result.total > 0))),
        );
      }),
    );
  }

  dismissReminder(signature: string): void {
    const user = this.userStore.currentUser();
    if (!user) {
      return;
    }

    const dismissals = this.readDismissals();
    dismissals[user.id] = signature;
    this.storage.setItem(DISMISSALS_KEY, JSON.stringify(dismissals));
  }

  private buildReminder(
    userId: string,
    results: Array<{ batchId: string; createdAt: string; total: number }>,
  ): NotificationRead | null {
    if (results.length === 0) {
      return null;
    }

    const unresolvedCount = results.reduce((sum, item) => sum + item.total, 0);
    const reviewBatchIds = results.map((item) => item.batchId);
    const signature = `${unresolvedCount}:${reviewBatchIds.join(',')}`;
    if (this.readDismissals()[userId] === signature) {
      return null;
    }

    return {
      id: `review-reminder:${signature}`,
      user_id: userId,
      type: NotificationType.METADATA_REVIEW,
      title: 'Some uploaded media still need names',
      body: `${unresolvedCount} uploaded file${unresolvedCount === 1 ? '' : 's'} still need character or series names.`,
      is_read: false,
      link_url: null,
      data: {
        latest_batch_id: results[0].batchId,
        review_batch_ids: reviewBatchIds,
        unresolved_count: unresolvedCount,
        dismiss_signature: signature,
      },
      created_at: results[0].createdAt,
    };
  }

  private readDismissals(): Record<string, string> {
    const raw = this.storage.getItem(DISMISSALS_KEY);
    if (!raw) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed ? parsed as Record<string, string> : {};
    } catch {
      return {};
    }
  }
}
