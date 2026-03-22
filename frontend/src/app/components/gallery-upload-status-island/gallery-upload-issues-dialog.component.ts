import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { type UploadQueueItem } from '../../services/media-upload.service';

export interface UploadIssuesDialogData {
  title: string;
  items: UploadQueueItem[];
}

@Component({
  selector: 'app-gallery-upload-issues-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatIconModule
  ],
  templateUrl: './gallery-upload-issues-dialog.component.html',
  styleUrl: './gallery-upload-issues-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryUploadIssuesDialogComponent {
  protected readonly data = inject<UploadIssuesDialogData>(MAT_DIALOG_DATA);

  issueRowMessage(item: UploadQueueItem): string {
    if (item.message?.trim()) {
      return item.message;
    }

    if (item.status === 'duplicate') {
      return 'Already uploaded';
    }

    if (item.status === 'failed') {
      return 'Processing failed';
    }

    return 'Upload failed';
  }
}
