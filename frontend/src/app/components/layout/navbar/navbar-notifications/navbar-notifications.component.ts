import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { EMPTY, catchError, finalize } from 'rxjs';
import { AlbumStore } from '../../../../services/album.store';
import {
  AnnouncementSeverity,
  AppUpdateNotificationData,
  NotificationRead,
  NotificationType,
  ShareInviteNotificationData,
} from '../../../../models/notifications';
import { AuthStore } from '../../../../services/web/auth.store';
import { NotificationsClientService } from '../../../../services/web/notifications-client.service';

@Component({
  selector: 'zukan-navbar-notifications',
  imports: [
    DatePipe,
    MatBadgeModule,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './navbar-notifications.component.html',
  styleUrl: './navbar-notifications.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavbarNotificationsComponent implements OnInit {
  private readonly authStore = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly notificationsClient = inject(NotificationsClientService);
  private readonly albumStore = inject(AlbumStore);
  private readonly snackBar = inject(MatSnackBar);

  readonly notifications = signal<NotificationRead[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly actioningIds = signal<string[]>([]);
  readonly unreadCount = computed(() => this.notifications().filter((item) => !item.is_read).length);
  readonly announcementSeverity = AnnouncementSeverity;

  ngOnInit(): void {
    if (!this.authStore.isAuthenticated()) {
      return;
    }

    this.loadNotifications();
  }

  loadNotifications(): void {
    this.loading.set(true);
    this.notificationsClient
      .list({ page_size: 8 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.notifications.set(response.items);
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

  isPendingShareInvite(notification: NotificationRead): notification is NotificationRead & { data: ShareInviteNotificationData } {
    return notification.type === NotificationType.SHARE_INVITE
      && !!notification.data
      && 'invite_status' in notification.data
      && notification.data.invite_status === 'pending';
  }

  isAppUpdate(notification: NotificationRead): notification is NotificationRead & { data: AppUpdateNotificationData | null } {
    return notification.type === NotificationType.APP_UPDATE;
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
    return !notification.is_read && !this.isPendingShareInvite(notification);
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
    ).subscribe((updated) => {
      this.notifications.update((items) => items.map((item) => item.id === updated.id ? updated : item));
    });
  }

  acceptInvite(notification: NotificationRead, event: Event): void {
    event.stopPropagation();
    if (!this.isPendingShareInvite(notification) || this.isActioning(notification.id)) {
      return;
    }

    this.setActioning(notification.id, true);
    this.notificationsClient.acceptInvite(notification.id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.setActioning(notification.id, false)),
      catchError((error: { error?: { detail?: string } }) => {
        this.snackBar.open(error.error?.detail ?? 'Unable to accept the album invite.', 'Close', { duration: 5000 });
        return EMPTY;
      }),
    ).subscribe(() => {
      this.snackBar.open(`Joined ${notification.data.album_name}.`, 'Close', { duration: 4000 });
      this.loadNotifications();
      this.albumStore.load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    });
  }

  rejectInvite(notification: NotificationRead, event: Event): void {
    event.stopPropagation();
    if (!this.isPendingShareInvite(notification) || this.isActioning(notification.id)) {
      return;
    }

    this.setActioning(notification.id, true);
    this.notificationsClient.rejectInvite(notification.id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.setActioning(notification.id, false)),
      catchError((error: { error?: { detail?: string } }) => {
        this.snackBar.open(error.error?.detail ?? 'Unable to reject the album invite.', 'Close', { duration: 5000 });
        return EMPTY;
      }),
    ).subscribe(() => {
      this.snackBar.open(`Declined ${notification.data.album_name}.`, 'Close', { duration: 4000 });
      this.loadNotifications();
    });
  }

  iconFor(type: NotificationType): string {
    switch (type) {
      case NotificationType.BATCH_DONE:
        return 'task_alt';
      case NotificationType.BATCH_FAILED:
        return 'error';
      case NotificationType.APP_UPDATE:
        return 'system_update';
      case NotificationType.SHARE_INVITE:
        return 'group_add';
    }
  }

  private setActioning(notificationId: string, active: boolean): void {
    this.actioningIds.update((ids) => active
      ? ids.includes(notificationId) ? ids : [...ids, notificationId]
      : ids.filter((id) => id !== notificationId));
  }
}
