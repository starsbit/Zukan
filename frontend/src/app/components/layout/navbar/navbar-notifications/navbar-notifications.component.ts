import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { EMPTY, catchError, finalize, forkJoin, of } from 'rxjs';
import {
  AppUpdateNotificationData,
  AnnouncementSeverity,
  MetadataReviewNotificationData,
  NotificationRead,
  NotificationType,
} from '../../../../models/notifications';
import { ReviewReminderService } from '../../../../services/review-reminder.service';
import { UploadReviewDialogComponent } from '../../upload-status/upload-review-dialog/upload-review-dialog.component';
import { AuthStore } from '../../../../services/web/auth.store';
import { NotificationsClientService } from '../../../../services/web/notifications-client.service';
import { FormattedMessageComponent } from '../../../shared/formatted-message/formatted-message.component';

@Component({
  selector: 'zukan-navbar-notifications',
  imports: [
    DatePipe,
    MatBadgeModule,
    MatButtonModule,
    MatDialogModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    FormattedMessageComponent,
  ],
  templateUrl: './navbar-notifications.component.html',
  styleUrl: './navbar-notifications.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavbarNotificationsComponent implements OnInit {
  private readonly authStore = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly notificationsClient = inject(NotificationsClientService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly reviewReminderService = inject(ReviewReminderService);
  private readonly dialog = inject(MatDialog);

  readonly notifications = signal<NotificationRead[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly actioningIds = signal<string[]>([]);
  readonly unreadCount = computed(
    () => this.notifications().filter((item) => !item.is_read).length,
  );
  readonly announcementSeverity = AnnouncementSeverity;

  ngOnInit(): void {
    if (!this.authStore.isAuthenticated()) {
      return;
    }

    this.loadNotifications();
  }

  loadNotifications(): void {
    this.loading.set(true);
    forkJoin({
      notifications: this.notificationsClient.list({ page_size: 8, is_read: false }).pipe(catchError(() => of(null))),
      reminder: this.reviewReminderService.loadReminder(true).pipe(catchError(() => of(null))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ notifications, reminder }) => {
          if (!notifications) {
            this.notifications.set([]);
            this.loading.set(false);
            this.error.set(true);
            return;
          }

          const prepended = [reminder].filter((n): n is NotificationRead => n !== null);
          this.notifications.set([...prepended, ...notifications.items]);
          this.loading.set(false);
          this.error.set(false);
        },
        error: () => {
          this.notifications.set([]);
          this.loading.set(false);
          this.error.set(true);
        },
      });
  }

  isAppUpdate(notification: NotificationRead): notification is NotificationRead & { data: AppUpdateNotificationData | null } {
    return notification.type === NotificationType.APP_UPDATE;
  }

  isMetadataReview(notification: NotificationRead): boolean {
    return notification.type === NotificationType.METADATA_REVIEW;
  }

  announcementSeverityFor(notification: NotificationRead): AnnouncementSeverity | null {
    if (!this.isAppUpdate(notification) || !notification.data || !('severity' in notification.data)) {
      return null;
    }
    return notification.data.severity as AnnouncementSeverity;
  }

  isActioning(notificationId: string): boolean {
    return this.actioningIds().includes(notificationId);
  }

  canMarkRead(notification: NotificationRead): boolean {
    return !notification.is_read && !this.isMetadataReview(notification);
  }

  markRead(notification: NotificationRead, event: Event): void {
    event.stopPropagation();
    if (!this.canMarkRead(notification) || this.isActioning(notification.id)) {
      return;
    }

    this.setActioning(notification.id, true);
    this.notificationsClient.markRead(notification.id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.setActioning(notification.id, false)),
      catchError((error: { error?: { detail?: string } }) => {
        this.snackBar.open(error.error?.detail ?? 'Unable to mark the notification as read.', 'Close', { duration: 5000 });
        return EMPTY;
      }),
    ).subscribe(() => {
      this.notifications.update((items) => items.filter((item) => item.id !== notification.id));
    });
  }

  reviewMetadata(notification: NotificationRead, event: Event): void {
    event.stopPropagation();
    if (!this.isMetadataReview(notification)) {
      return;
    }

    this.dialog.open(UploadReviewDialogComponent, {
      data: { batchId: null },
      maxWidth: '96vw',
      width: '1100px',
      panelClass: 'upload-status-dialog-panel',
      autoFocus: false,
    }).afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadNotifications());
  }

  dismissMetadataReminder(notification: NotificationRead, event: Event): void {
    event.stopPropagation();
    if (!this.hasMetadataReviewData(notification)) {
      return;
    }

    this.reviewReminderService.dismissReminder(notification.data.dismiss_signature);
    this.notifications.update((items) => items.filter((item) => item.id !== notification.id));
  }

  iconFor(type: NotificationType): string {
    switch (type) {
      case NotificationType.BATCH_DONE:
        return 'task_alt';
      case NotificationType.BATCH_FAILED:
        return 'error';
      case NotificationType.APP_UPDATE:
        return 'system_update';
      case NotificationType.METADATA_REVIEW:
        return 'edit_note';
      case NotificationType.WELCOME:
        return 'waving_hand';
    }
  }

  private setActioning(notificationId: string, active: boolean): void {
    this.actioningIds.update((ids) => active
      ? ids.includes(notificationId) ? ids : [...ids, notificationId]
      : ids.filter((id) => id !== notificationId));
  }

  private hasMetadataReviewData(
    notification: NotificationRead,
  ): notification is NotificationRead & { data: MetadataReviewNotificationData } {
    return (
      this.isMetadataReview(notification) &&
      !!notification.data &&
      'dismiss_signature' in notification.data
    );
  }
}
