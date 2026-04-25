import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import {
  AdminEmbeddingClusterListResponse,
  AdminEmbeddingClusterRead,
  AdminLibraryClassificationMetricsResponse,
  AdminUserSummary,
  EmbeddingClusterMode,
} from '../../../models/admin';
import { AdminService } from '../../../services/admin.service';

export interface AdminEmbeddingClustersDialogData {
  user: AdminUserSummary;
}

@Component({
  selector: 'zukan-admin-embedding-clusters-dialog',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTabsModule,
  ],
  templateUrl: './admin-embedding-clusters-dialog.component.html',
  styleUrl: './admin-embedding-clusters-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminEmbeddingClustersDialogComponent {
  private readonly adminService = inject(AdminService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef<AdminEmbeddingClustersDialogComponent>);
  protected readonly data = inject<AdminEmbeddingClustersDialogData>(MAT_DIALOG_DATA);

  protected readonly labelClusters = signal<AdminEmbeddingClusterListResponse | null>(null);
  protected readonly unsupervisedClusters = signal<AdminEmbeddingClusterListResponse | null>(null);
  protected readonly loadingLabel = signal(true);
  protected readonly loadingUnsupervised = signal(true);
  protected readonly labelError = signal<string | null>(null);
  protected readonly unsupervisedError = signal<string | null>(null);
  protected readonly plotUrl = signal<string | null>(null);
  protected readonly loadingPlot = signal(true);
  protected readonly plotError = signal<string | null>(null);
  protected readonly plotMode = signal<EmbeddingClusterMode>('label');
  protected readonly metrics = signal<AdminLibraryClassificationMetricsResponse | null>(null);
  protected readonly loadingMetrics = signal(true);
  protected readonly metricsError = signal<string | null>(null);

  protected readonly modelVersion = computed(() =>
    this.metrics()?.model_version ?? this.labelClusters()?.model_version ?? this.unsupervisedClusters()?.model_version ?? 'current',
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.revokePlotUrl());
    this.loadPlot('label');
    this.load('label');
    this.load('unsupervised');
    this.loadMetrics();
  }

  protected close(): void {
    this.dialogRef.close();
  }

  protected displayLabel(cluster: AdminEmbeddingClusterRead): string {
    return cluster.label || cluster.id;
  }

  protected similarity(value: number | null): string {
    return value == null ? 'n/a' : value.toFixed(3);
  }

  protected percentage(value: number | null): string {
    return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
  }

  protected showPlot(mode: EmbeddingClusterMode): void {
    if (this.plotMode() === mode && this.plotUrl()) {
      return;
    }
    this.loadPlot(mode);
  }

  private loadPlot(mode: EmbeddingClusterMode): void {
    this.plotMode.set(mode);
    this.loadingPlot.set(true);
    this.plotError.set(null);
    this.adminService.getEmbeddingClusterPlot(this.data.user.id, mode, {
      min_cluster_size: 2,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (blob) => {
        this.revokePlotUrl();
        this.plotUrl.set(URL.createObjectURL(blob));
        this.loadingPlot.set(false);
      },
      error: (err) => {
        this.revokePlotUrl();
        this.plotError.set(err.error?.detail ?? 'Unable to load embedding map.');
        this.loadingPlot.set(false);
      },
    });
  }

  private load(mode: EmbeddingClusterMode): void {
    const loading = mode === 'label' ? this.loadingLabel : this.loadingUnsupervised;
    const error = mode === 'label' ? this.labelError : this.unsupervisedError;
    loading.set(true);
    error.set(null);
    this.adminService.getEmbeddingClusters(this.data.user.id, mode, {
      sample_size: 6,
      min_cluster_size: 2,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        if (mode === 'label') {
          this.labelClusters.set(response);
        } else {
          this.unsupervisedClusters.set(response);
        }
        loading.set(false);
      },
      error: (err) => {
        error.set(err.error?.detail ?? 'Unable to load embedding clusters.');
        loading.set(false);
      },
    });
  }

  private loadMetrics(): void {
    this.loadingMetrics.set(true);
    this.metricsError.set(null);
    this.adminService.getLibraryClassificationMetrics(this.data.user.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.metrics.set(response);
          this.loadingMetrics.set(false);
        },
        error: (err) => {
          this.metricsError.set(err.error?.detail ?? 'Unable to load classifier accuracy.');
          this.loadingMetrics.set(false);
        },
      });
  }

  private revokePlotUrl(): void {
    const current = this.plotUrl();
    if (current) {
      URL.revokeObjectURL(current);
      this.plotUrl.set(null);
    }
  }
}
