import { AsyncPipe, TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { MediaUploadService } from '../../services/media-upload.service';

@Component({
  selector: 'app-gallery-upload-status-island',
  imports: [
    AsyncPipe,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    TitleCasePipe
  ],
  templateUrl: './gallery-upload-status-island.component.html',
  styleUrl: './gallery-upload-status-island.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryUploadStatusIslandComponent {
  private readonly uploadService = inject(MediaUploadService);

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

  progressValue(uploadProgress: number | null, processingProgress: number | null, phase: string): number {
    if (phase === 'uploading') {
      return uploadProgress ?? 100;
    }

    return processingProgress ?? 100;
  }
}
