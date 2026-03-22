import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { MediaUploadService, type UploadQueueItem, type UploadSession } from '../../services/media-upload.service';
import { GalleryUploadIssuesDialogComponent } from './gallery-upload-issues-dialog.component';

@Component({
  selector: 'app-gallery-upload-status-island',
  imports: [
    AsyncPipe,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule
  ],
  templateUrl: './gallery-upload-status-island.component.html',
  styleUrl: './gallery-upload-status-island.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryUploadStatusIslandComponent {
  private readonly uploadService = inject(MediaUploadService);
  private readonly dialog = inject(MatDialog);

  readonly session$ = this.uploadService.session$;

  collapse(): void {
    this.uploadService.collapse();
  }

  expand(): void {
    this.uploadService.expand();
  }

  dismiss(): void {
    this.uploadService.dismissSession();
  }

  openDuplicateDialog(session: UploadSession): void {
    const items = this.duplicateItems(session);
    if (items.length === 0) {
      return;
    }

    this.dialog.open(GalleryUploadIssuesDialogComponent, {
      data: {
        title: 'Duplicate files',
        items
      },
      width: 'min(42rem, calc(100vw - 2rem))'
    });
  }

  openIssueDialog(session: UploadSession): void {
    const items = this.issueItems(session);
    if (items.length === 0) {
      return;
    }

    this.dialog.open(GalleryUploadIssuesDialogComponent, {
      data: {
        title: 'Errors and processing failures',
        items
      },
      width: 'min(42rem, calc(100vw - 2rem))'
    });
  }

  duplicateCount(session: UploadSession): number {
    return this.duplicateItems(session).length;
  }

  issueCount(session: UploadSession): number {
    return this.issueItems(session).length;
  }

  progressValue(uploadProgress: number | null, processingProgress: number | null, phase: string): number {
    if (phase === 'uploading') {
      return uploadProgress ?? 100;
    }

    return processingProgress ?? 100;
  }

  phaseLabel(phase: string): string {
    return phase
      .split('_')
      .filter((part) => part.length > 0)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ');
  }

  private duplicateItems(session: UploadSession): UploadQueueItem[] {
    return session.items.filter((item) => item.status === 'duplicate');
  }

  private issueItems(session: UploadSession): UploadQueueItem[] {
    return session.items.filter((item) => item.status === 'error' || item.status === 'failed');
  }
}
