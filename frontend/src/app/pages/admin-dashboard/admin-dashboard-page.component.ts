import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { interval, startWith, switchMap } from 'rxjs';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { StoragePanelComponent } from '../../components/admin/storage-panel.component';
import { AdminClientService } from '../../services/web/admin-client.service';
import {
  AdminStatsResponse,
  AdminHealthResponse,
  AdminEmbeddingBackfillStatus,
} from '../../models/admin';
import { extractApiError } from '../../utils/api-error.utils';

@Component({
  selector: 'zukan-admin-dashboard-page',
  imports: [LayoutComponent, StoragePanelComponent, DecimalPipe, MatButtonModule, MatCardModule],
  template: `<zukan-layout
    ><section class="admin-shell">
      <h1>Library maintenance</h1>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      @if (stats(); as s) {
        <mat-card
          ><mat-card-content
            ><p>
              {{ s.total_media }} media · {{ s.total_storage_bytes | number }} bytes ·
              {{ s.trashed_media }} in trash
            </p>
            <p>
              {{ s.pending_tagging }} pending tagging · {{ s.failed_tagging }} failed
            </p></mat-card-content
          ></mat-card
        >
      }
      @if (health(); as h) {
        <p>
          CPU {{ h.cpu_percent }}% · Process memory {{ h.memory_rss_bytes | number }} bytes · Queue
          {{ h.tagging_queue_depth }}
        </p>
      }
      <button mat-stroked-button (click)="retag()" [disabled]="busy()">Retag library</button>
      <button mat-stroked-button (click)="backfill()" [disabled]="busy()">
        Backfill embeddings
      </button>
      @if (message()) {
        <p role="status">{{ message() }}</p>
      }
      @if (batch(); as b) {
        <p>
          Embedding backfill: {{ b.status }} · {{ b.done_items }}/{{ b.total_items }} completed ·
          {{ b.failed_items }} failed
        </p>
      }
      <zukan-storage-panel /></section
  ></zukan-layout>`,
  styleUrl: './admin-dashboard-page.component.scss',
})
export class AdminDashboardPageComponent {
  private readonly client = inject(AdminClientService);
  private readonly destroy = inject(DestroyRef);
  readonly stats = signal<AdminStatsResponse | null>(null);
  readonly health = signal<AdminHealthResponse | null>(null);
  readonly batch = signal<AdminEmbeddingBackfillStatus | null>(null);
  readonly error = signal<string | null>(null);
  readonly message = signal('');
  readonly busy = signal(false);
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
    interval(5000)
      .pipe(
        startWith(0),
        takeUntilDestroyed(this.destroy),
        switchMap(() => this.client.getHealth()),
      )
      .subscribe({
        next: (h) => this.health.set(h),
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
        this.message.set(`${r.queued} media queued`);
      },
      error: (e) => this.failed(e),
    });
  }
  backfill() {
    this.busy.set(true);
    this.client.startEmbeddingBackfill().subscribe({
      next: (r) => {
        this.busy.set(false);
        this.message.set(`${r.queued} embeddings queued`);
        if (r.batch_id) this.pollBatch(r.batch_id);
      },
      error: (e) => this.failed(e),
    });
  }
  private pollBatch(id: string) {
    this.client
      .getEmbeddingBackfillStatus(id)
      .subscribe({
        next: (b) => this.batch.set(b),
        error: (e) => this.error.set(extractApiError(e)),
      });
  }
  private failed(e: unknown) {
    this.busy.set(false);
    this.error.set(extractApiError(e));
  }
}
