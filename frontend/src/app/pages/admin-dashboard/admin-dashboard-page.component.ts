import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { interval, startWith, switchMap, finalize } from 'rxjs';
import type { EChartsCoreOption } from 'echarts/core';
import { AdminUserEditDialogComponent } from '../../components/admin/admin-user-edit-dialog/admin-user-edit-dialog.component';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { EchartPanelComponent } from '../../components/shared/echart-panel/echart-panel.component';
import {
  AdminHealthResponse,
  AdminStatsResponse,
  AdminUserSummary,
  AdminUserUpdate,
} from '../../models/admin';
import { AnnouncementSeverity } from '../../models/notifications';
import { AdminService } from '../../services/admin.service';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { UserStore } from '../../services/user.store';

type UserSortKey = 'username' | 'email' | 'created_at' | 'media_count' | 'storage_used_mb';

@Component({
  selector: 'zukan-admin-dashboard-page',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    DecimalPipe,
    LayoutComponent,
    EchartPanelComponent,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTableModule,
  ],
  templateUrl: './admin-dashboard-page.component.html',
  styleUrl: './admin-dashboard-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboardPageComponent {
  private readonly adminService = inject(AdminService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly userStore = inject(UserStore);

  readonly announcementSeverity = AnnouncementSeverity;
  readonly displayedColumns = ['username', 'email', 'role', 'media', 'storage', 'created', 'actions'];
  readonly loadingOverview = signal(true);
  readonly loadingUsers = signal(true);
  readonly loadingAnnouncements = signal(true);
  readonly submittingAnnouncement = signal(false);
  readonly overviewError = signal<string | null>(null);
  readonly usersError = signal<string | null>(null);
  readonly announcementsError = signal<string | null>(null);
  readonly stats = signal<AdminStatsResponse | null>(null);
  readonly health = signal<AdminHealthResponse | null>(null);
  readonly users = signal<AdminUserSummary[]>([]);
  readonly announcements = signal<any[]>([]);
  readonly userFilter = signal('');
  readonly userSort = signal<UserSortKey>('storage_used_mb');
  readonly currentUser = this.userStore.currentUser;

  readonly announcementForm = this.fb.nonNullable.group({
    version: [''],
    title: ['', [Validators.required, Validators.maxLength(120)]],
    message: ['', [Validators.required, Validators.maxLength(2000)]],
    severity: [AnnouncementSeverity.INFO],
  });

  readonly filteredUsers = computed(() => {
    const term = this.userFilter().trim().toLowerCase();
    const sorted = [...this.users()].filter((user) => {
      if (!term) {
        return true;
      }
      return [user.username, user.email].some((value) => value.toLowerCase().includes(term));
    });
    const sortKey = this.userSort();
    sorted.sort((a, b) => {
      if (sortKey === 'created_at') {
        return Date.parse(b.created_at) - Date.parse(a.created_at);
      }
      if (sortKey === 'media_count' || sortKey === 'storage_used_mb') {
        return b[sortKey] - a[sortKey];
      }
      return (a[sortKey] as string).localeCompare(b[sortKey] as string);
    });
    return sorted;
  });

  readonly storageChartOption = computed<EChartsCoreOption>(() => {
    const stats = this.stats();
    const topUsers = [...(stats?.storage_by_user ?? [])]
      .sort((a, b) => b.storage_used_bytes - a.storage_used_bytes)
      .slice(0, 8);

    return {
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: number) => this.formatBytes(value),
      },
      grid: { left: 24, right: 24, top: 24, bottom: 56 },
      xAxis: {
        type: 'category',
        data: topUsers.map((user) => user.username),
        axisLabel: { interval: 0, rotate: 18 },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => this.formatBytes(value),
        },
      },
      series: [
        {
          type: 'bar',
          name: 'Storage',
          data: topUsers.map((user) => user.storage_used_bytes),
          itemStyle: { color: '#1d4ed8', borderRadius: [8, 8, 0, 0] },
        },
      ],
    };
  });

  readonly cpuChartOption = computed(() => this.buildHealthChart('cpu'));
  readonly memoryChartOption = computed(() => this.buildHealthChart('memory'));

  constructor() {
    interval(10000)
      .pipe(
        startWith(0),
        switchMap(() => this.adminService.getStats()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (stats) => {
          this.stats.set(stats);
          this.loadingOverview.set(false);
          this.overviewError.set(null);
        },
        error: (err) => {
          this.loadingOverview.set(false);
          this.overviewError.set(err.error?.detail ?? 'Unable to load admin statistics.');
        },
      });

    interval(5000)
      .pipe(
        startWith(0),
        switchMap(() => this.adminService.getHealth()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (health) => {
          this.health.set(health);
          this.loadingOverview.set(false);
          this.overviewError.set(null);
        },
        error: (err) => {
          this.loadingOverview.set(false);
          this.overviewError.set(err.error?.detail ?? 'Unable to load backend health.');
        },
      });

    this.loadUsers();
    this.loadAnnouncements();
  }

  onFilterChange(value: string): void {
    this.userFilter.set(value);
  }

  onSortChange(value: UserSortKey): void {
    this.userSort.set(value);
  }

  openEditUser(user: AdminUserSummary): void {
    this.dialog.open(AdminUserEditDialogComponent, {
      data: { user, currentUserId: this.currentUser()?.id ?? null },
      width: 'min(34rem, 92vw)',
    }).afterClosed().subscribe((body: AdminUserUpdate | null) => {
      if (!body) {
        return;
      }
      this.adminService.updateUser(user.id, body).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (updated) => {
          if (updated.id === this.currentUser()?.id) {
            this.userStore.update({ username: updated.username });
          }
          this.snackBar.open(`Updated ${updated.username}.`, 'Close');
          this.loadUsers();
        },
        error: (err) => {
          this.snackBar.open(err.error?.detail ?? 'Unable to update user.', 'Close');
        },
      });
    });
  }

  reprocessLibrary(user: AdminUserSummary): void {
    this.adminService.retagAll(user.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.snackBar.open(`Queued ${response.queued} media items for ${user.username}.`, 'Close');
      },
      error: (err) => {
        this.snackBar.open(err.error?.detail ?? 'Unable to queue reprocessing.', 'Close');
      },
    });
  }

  deleteAllMedia(user: AdminUserSummary): void {
    this.confirmDialog.open({
      title: 'Delete all media?',
      message: `This will permanently purge every media file uploaded by ${user.username}. This cannot be undone.`,
      confirmLabel: 'Delete all media',
      tone: 'warn',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.adminService.deleteUserMedia(user.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (response) => {
          this.snackBar.open(`Deleted ${response.deleted} media items for ${user.username}.`, 'Close');
          this.loadUsers();
          this.reloadStats();
        },
        error: (err) => {
          this.snackBar.open(err.error?.detail ?? 'Unable to delete media.', 'Close');
        },
      });
    });
  }

  deleteUser(user: AdminUserSummary): void {
    this.confirmDialog.open({
      title: 'Delete user?',
      message: `Delete the account for ${user.username}. Existing media ownership references may remain detached.`,
      confirmLabel: 'Delete user',
      tone: 'warn',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.adminService.deleteUser(user.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.snackBar.open(`Deleted ${user.username}.`, 'Close');
          this.loadUsers();
          this.reloadStats();
        },
        error: (err) => {
          this.snackBar.open(err.error?.detail ?? 'Unable to delete user.', 'Close');
        },
      });
    });
  }

  publishAnnouncement(): void {
    if (this.announcementForm.invalid || this.submittingAnnouncement()) {
      this.announcementForm.markAllAsTouched();
      return;
    }

    this.submittingAnnouncement.set(true);
    const value = this.announcementForm.getRawValue();
    this.adminService.createAnnouncement({
      version: value.version.trim() || null,
      title: value.title.trim(),
      message: value.message.trim(),
      severity: value.severity,
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.submittingAnnouncement.set(false)),
    ).subscribe({
      next: () => {
        this.announcementForm.reset({
          version: '',
          title: '',
          message: '',
          severity: AnnouncementSeverity.INFO,
        });
        this.snackBar.open('Announcement published.', 'Close');
        this.loadAnnouncements();
      },
      error: (err) => {
        this.snackBar.open(err.error?.detail ?? 'Unable to publish announcement.', 'Close');
      },
    });
  }

  isSelf(user: AdminUserSummary): boolean {
    return user.id === this.currentUser()?.id;
  }

  formatMb(mb: number): string {
    if (mb >= 1024) {
      const gb = mb / 1024;
      return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
    }
    return `${mb} MB`;
  }

  formatBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const size = value / 1024 ** exponent;
    return `${size.toFixed(size >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  }

  private loadUsers(): void {
    this.loadingUsers.set(true);
    this.adminService.listUsers({ page: 1, page_size: 200, sort_by: 'created_at', sort_order: 'desc' })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loadingUsers.set(false)),
      )
      .subscribe({
        next: (response) => {
          this.users.set(response.items);
          this.usersError.set(null);
        },
        error: (err) => {
          this.usersError.set(err.error?.detail ?? 'Unable to load users.');
        },
      });
  }

  private loadAnnouncements(): void {
    this.loadingAnnouncements.set(true);
    this.adminService.listAnnouncements().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loadingAnnouncements.set(false)),
    ).subscribe({
      next: (announcements) => {
        this.announcements.set(announcements);
        this.announcementsError.set(null);
      },
      error: (err) => {
        this.announcementsError.set(err.error?.detail ?? 'Unable to load announcements.');
      },
    });
  }

  private reloadStats(): void {
    this.adminService.getStats().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (stats) => this.stats.set(stats),
    });
  }

  private buildHealthChart(metric: 'cpu' | 'memory'): EChartsCoreOption {
    const health = this.health();
    const samples = health?.samples ?? [];
    return {
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: number) => metric === 'cpu' ? `${value}%` : this.formatBytes(value),
      },
      grid: { left: 24, right: 24, top: 24, bottom: 32 },
      xAxis: {
        type: 'category',
        data: samples.map((sample) => new Date(sample.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })),
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => metric === 'cpu' ? `${value}%` : this.formatBytes(value),
        },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          showSymbol: false,
          areaStyle: { opacity: 0.14 },
          lineStyle: { width: 3, color: metric === 'cpu' ? '#0f766e' : '#9333ea' },
          itemStyle: { color: metric === 'cpu' ? '#0f766e' : '#9333ea' },
          data: samples.map((sample) => metric === 'cpu' ? sample.cpu_percent : sample.memory_rss_bytes),
        },
      ],
    };
  }
}
