import { Injectable, inject } from '@angular/core';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';
import { NotificationRead, NotificationType } from '../models/notifications';
import { ImportBatchReviewSummaryResponse } from '../models/processing';
import { UserStore } from './user.store';
import { LOCAL_STORAGE } from './web/auth.store';
import { BatchesClientService } from './web/batches-client.service';

const DISMISSALS_KEY = 'zukan_metadata_review_dismissals';

@Injectable({ providedIn: 'root' })
export class ReviewReminderService {
  private readonly storage = inject(LOCAL_STORAGE);
  private readonly userStore = inject(UserStore);
  private readonly batchesClient = inject(BatchesClientService);
  private cachedReminder$: Observable<NotificationRead | null> | null = null;
  private cachedForUserId: string | null = null;

  loadReminder(forceRefresh = false): Observable<NotificationRead | null> {
    const user = this.userStore.currentUser();
    if (!user) {
      this.cachedReminder$ = null;
      this.cachedForUserId = null;
      return of(null);
    }

    if (forceRefresh || this.cachedForUserId !== user.id || this.cachedReminder$ === null) {
      this.cachedForUserId = user.id;
      this.cachedReminder$ = this.batchesClient.listReviewSummary().pipe(
        map((summary) => this.buildReminder(user.id, summary)),
        catchError(() => of(null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }

    return this.cachedReminder$;
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
    summary: ImportBatchReviewSummaryResponse,
  ): NotificationRead | null {
    if (summary.unresolved_count <= 0 || summary.review_batch_ids.length === 0 || !summary.latest_batch_id) {
      return null;
    }

    const unresolvedCount = summary.unresolved_count;
    const reviewBatchIds = summary.review_batch_ids;
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
        latest_batch_id: summary.latest_batch_id,
        review_batch_ids: reviewBatchIds,
        unresolved_count: unresolvedCount,
        dismiss_signature: signature,
      },
      created_at: summary.latest_batch_created_at ?? new Date().toISOString(),
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
