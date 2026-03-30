import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { UploadStatusFilter, filterLabel } from '../../../../models/upload-tracker';
import { UploadTrackerService } from '../../../../services/upload-tracker.service';
import { UploadStatusDialogComponent } from '../upload-status-dialog/upload-status-dialog.component';

@Component({
  selector: 'zukan-upload-status-island',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  templateUrl: './upload-status-island.component.html',
  styleUrl: './upload-status-island.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadStatusIslandComponent {
  private readonly dialog = inject(MatDialog);
  readonly tracker = inject(UploadTrackerService);
  readonly expanded = signal(true);

  readonly summary = this.tracker.summary;
  readonly chips = this.tracker.countChips;
  readonly visible = this.tracker.visible;
  readonly totalFiles = computed(() => this.summary().totalTrackedItems);
  readonly hasUploadRequests = computed(() => {
    const requestCounts = this.summary().requestCounts;
    return requestCounts.queued + requestCounts.uploading + requestCounts.completed + requestCounts.failed > 0;
  });
  readonly phase = computed<'uploading' | 'processing' | 'completed' | 'completed_with_errors' | 'failed'>(() => {
    const requestCounts = this.summary().requestCounts;
    const itemCounts = this.summary().itemCounts;

    if (requestCounts.uploading > 0) {
      return 'uploading';
    }

    if (this.summary().activeBatchCount > 0 || itemCounts.pending > 0 || itemCounts.processing > 0) {
      return 'processing';
    }

    if (requestCounts.failed > 0 && this.summary().completedItems === 0) {
      return 'failed';
    }

    if (itemCounts.failed > 0 || itemCounts.upload_error > 0) {
      return 'completed_with_errors';
    }

    return 'completed';
  });
  readonly title = computed(() =>
    `${this.totalFiles()} file${this.totalFiles() === 1 ? '' : 's'}`,
  );
  readonly subtitle = computed(() => this.phaseLabel(this.phase()));
  readonly acceptedCount = computed(() =>
    Math.max(
      this.summary().totalTrackedItems
      - this.summary().itemCounts.duplicate
      - this.summary().itemCounts.upload_error,
      0,
    ),
  );
  readonly issueCount = computed(() =>
    this.summary().itemCounts.failed + this.summary().itemCounts.upload_error,
  );
  readonly progressMode = computed<'determinate' | 'indeterminate'>(() =>
    this.phase() === 'uploading' && this.summary().completedItems === 0
      ? 'indeterminate'
      : 'determinate',
  );
  readonly progressValue = computed(() =>
    this.progressMode() === 'indeterminate' ? 100 : this.summary().progressPercent,
  );
  readonly statusCopy = computed(() => {
    switch (this.phase()) {
      case 'processing':
        return `${this.summary().completedItems} of ${this.acceptedCount()} finished processing`;
      case 'uploading':
        return 'Uploading your batch to the gallery';
      case 'completed_with_errors':
        return 'Upload finished with some issues';
      case 'completed':
        return 'Upload and processing finished';
      case 'failed':
        return 'Upload failed';
    }
  });

  openDetails(filter: UploadStatusFilter, title?: string): void {
    this.dialog.open(UploadStatusDialogComponent, {
      data: {
        initialFilter: filter,
        summary: this.summary(),
        title,
      },
      maxWidth: '90vw',
      panelClass: 'upload-status-dialog-panel',
    });
  }

  openIssuesDialog(): void {
    this.dialog.open(UploadStatusDialogComponent, {
      data: {
        initialFilter: 'failed',
        summary: this.summary(),
        title: 'Errors and processing failures',
        availableFilters: ['issue_group', 'failed', 'upload_error'],
      },
      maxWidth: '90vw',
      panelClass: 'upload-status-dialog-panel',
    });
  }

  collapse(): void {
    this.expanded.set(false);
  }

  expand(): void {
    this.expanded.set(true);
  }

  dismiss(): void {
    this.tracker.dismiss();
  }

  duplicateCount(): number {
    return this.summary().itemCounts.duplicate;
  }

  phaseIcon(): string {
    switch (this.phase()) {
      case 'completed':
        return 'check';
      case 'completed_with_errors':
      case 'failed':
        return 'error';
      default:
        return 'cloud_upload';
    }
  }

  collapsedIcon(): string {
    return this.phase() === 'completed' ? 'check_circle' : 'cloud_upload';
  }

  collapsedLabel(): string {
    if (this.phase() === 'completed') {
      return this.hasUploadRequests() ? 'Upload complete' : 'Processing complete';
    }

    return this.hasUploadRequests() ? 'Uploads active' : 'Processing active';
  }

  phaseLabel(phase: string): string {
    return phase
      .split('_')
      .filter((part) => part.length > 0)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ');
  }

  chipLabel(filter: UploadStatusFilter): string {
    return filterLabel(filter);
  }
}
