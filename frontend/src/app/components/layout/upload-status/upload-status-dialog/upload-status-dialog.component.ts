import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { UploadStatusDialogItem, UploadStatusFilter, UploadStatusSummary, filterLabel } from '../../../../models/upload-tracker';
import { UploadTrackerService } from '../../../../services/upload-tracker.service';
import { UploadStatusPreviewComponent } from '../upload-status-preview/upload-status-preview.component';

export interface UploadStatusDialogData {
  initialFilter: UploadStatusFilter;
  summary: UploadStatusSummary;
  title?: string;
  availableFilters?: Array<UploadStatusFilter | 'issue_group'>;
}

type UploadStatusDialogSelection = UploadStatusFilter | 'issue_group';

@Component({
  selector: 'zukan-upload-status-dialog',
  standalone: true,
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatDividerModule,
    MatIconModule,
    MatListModule,
    UploadStatusPreviewComponent,
  ],
  templateUrl: './upload-status-dialog.component.html',
  styleUrl: './upload-status-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadStatusDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<UploadStatusDialogComponent>);
  private readonly data = inject<UploadStatusDialogData>(MAT_DIALOG_DATA);
  private readonly tracker = inject(UploadTrackerService);

  readonly selectedFilter = signal<UploadStatusDialogSelection>(this.data.initialFilter);
  readonly filters = computed(() =>
    (this.data.availableFilters ?? (Object.keys(this.tracker.summary().itemCounts) as UploadStatusFilter[]))
      .filter((filter) => this.countForFilter(filter) > 0)
      .map((filter) => ({
        filter,
        label: this.labelForFilter(filter),
        count: this.countForFilter(filter),
      })),
  );
  readonly items = computed<UploadStatusDialogItem[]>(() =>
    this.itemsForFilter(this.selectedFilter()),
  );
  readonly title = computed(() => this.data.title ?? `${this.labelForFilter(this.selectedFilter())} media`);

  close(): void {
    this.dialogRef.close();
  }

  itemMessage(item: UploadStatusDialogItem): string {
    if (item.error?.trim()) {
      return item.error;
    }

    if (item.filter === 'duplicate') {
      return 'Already uploaded';
    }

    if (item.filter === 'done') {
      return 'Processed successfully';
    }

    if (item.filter === 'processing') {
      return item.progressPercent === null
        ? 'Currently processing'
        : `Processing ${item.progressPercent}%`;
    }

    if (item.filter === 'pending') {
      return 'Waiting to be processed';
    }

    if (item.filter === 'skipped') {
      return 'Skipped during processing';
    }

    return 'Upload failed';
  }

  private itemsForFilter(filter: UploadStatusDialogSelection): UploadStatusDialogItem[] {
    if (filter === 'issue_group') {
      return [
        ...(this.tracker.itemsByFilter().failed ?? []),
        ...(this.tracker.itemsByFilter().upload_error ?? []),
      ];
    }

    return this.tracker.itemsByFilter()[filter] ?? [];
  }

  private countForFilter(filter: UploadStatusDialogSelection): number {
    if (filter === 'issue_group') {
      return this.tracker.summary().itemCounts.failed + this.tracker.summary().itemCounts.upload_error;
    }

    return this.tracker.summary().itemCounts[filter];
  }

  private labelForFilter(filter: UploadStatusDialogSelection): string {
    if (filter === 'issue_group') {
      return 'All issues';
    }

    return filterLabel(filter);
  }

  trackByItem(_: number, item: UploadStatusDialogItem): string {
    return item.id;
  }
}
