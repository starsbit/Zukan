import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { interval, startWith, switchMap } from 'rxjs';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { StoragePanelComponent } from '../../components/admin/storage-panel.component';
import { AdminClientService } from '../../services/web/admin-client.service';
import { AdminStatsResponse, AdminEmbeddingBackfillStatus } from '../../models/admin';
import { extractApiError } from '../../utils/api-error.utils';
import { formatFileSize } from '../../utils/media-display.utils';

interface StatTile {
  icon: string;
  label: string;
  value: string;
  tone?: 'warn';
}

@Component({
  selector: 'zukan-admin-dashboard-page',
  imports: [
    LayoutComponent,
    StoragePanelComponent,
    DecimalPipe,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  templateUrl: './admin-dashboard-page.component.html',
  styleUrl: './admin-dashboard-page.component.scss',
})
export class AdminDashboardPageComponent {
  private readonly client = inject(AdminClientService);
  private readonly destroy = inject(DestroyRef);
  readonly stats = signal<AdminStatsResponse | null>(null);
  readonly batch = signal<AdminEmbeddingBackfillStatus | null>(null);
  readonly error = signal<string | null>(null);
  readonly message = signal('');
  readonly busy = signal(false);
  readonly tiles = computed<StatTile[]>(() => {
    const s = this.stats();
    if (!s) {
      return [];
    }
    const number = new Intl.NumberFormat();
    return [
      { icon: 'photo_library', label: 'Media', value: number.format(s.total_media) },
      { icon: 'storage', label: 'Storage used', value: formatFileSize(s.total_storage_bytes) },
      { icon: 'delete', label: 'In trash', value: number.format(s.trashed_media) },
      { icon: 'hourglass_top', label: 'Pending tagging', value: number.format(s.pending_tagging) },
      {
        icon: 'error_outline',
        label: 'Failed tagging',
        value: number.format(s.failed_tagging),
        tone: s.failed_tagging > 0 ? 'warn' : undefined,
      },
    ];
  });
  readonly batchProgress = computed(() => {
    const b = this.batch();
    return b && b.total_items > 0 ? ((b.done_items + b.failed_items) / b.total_items) * 100 : 0;
  });

  constructor() {
    interval(5000)
      .pipe(
        startWith(0),
        takeUntilDestroyed(this.destroy),
        switchMap(() => this.client.getStats()),
      )
      .subscribe({
        next: (s) => this.stats.set(s),
        error: (e) => this.error.set(extractApiError(e)),
      });
    interval(3000)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe(() => {
        const b = this.batch();
        if (b && ['pending', 'running'].includes(b.status)) this.pollBatch(b.batch_id);
      });
  }

  retag() {
    this.busy.set(true);
    this.client.retagAll().subscribe({
      next: (r) => {
        this.busy.set(false);
        this.message.set(`${r.queued} media queued for tagging.`);
      },
      error: (e) => this.failed(e),
    });
  }

  backfill() {
    this.busy.set(true);
    this.client.startEmbeddingBackfill().subscribe({
      next: (r) => {
        this.busy.set(false);
        this.message.set(`${r.queued} embeddings queued.`);
        if (r.batch_id) this.pollBatch(r.batch_id);
      },
      error: (e) => this.failed(e),
    });
  }

  private pollBatch(id: string) {
    this.client.getEmbeddingBackfillStatus(id).subscribe({
      next: (b) => this.batch.set(b),
      error: (e) => this.error.set(extractApiError(e)),
    });
  }

  private failed(e: unknown) {
    this.busy.set(false);
    this.error.set(extractApiError(e));
  }
}
