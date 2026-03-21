import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { MediaRead } from '../../models/api';
import { MediaUploadService } from '../../services/media-upload.service';
import { MediaClientService } from '../../services/web/media-client.service';

@Component({
  selector: 'app-gallery-viewer',
  imports: [CommonModule, DatePipe, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './gallery-viewer.component.html',
  styleUrl: './gallery-viewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryViewerComponent implements OnChanges, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly mediaClient = inject(MediaClientService);
  private readonly mediaUploadService = inject(MediaUploadService);
  private mediaRequestId = 0;

  @Input() media: MediaRead | null = null;
  @Input() canRestore = false;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly restoreRequested = new EventEmitter<MediaRead>();

  mediaUrl: string | null = null;
  loading = false;
  failed = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['media']) {
      if (this.media) {
        this.loadMedia();
      } else {
        this.resetViewer();
      }
    }
  }

  ngOnDestroy(): void {
    this.revokeMediaUrl();
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.media) {
      this.close();
    }
  }

  close(): void {
    this.closed.emit();
  }

  restore(): void {
    if (!this.media) {
      return;
    }

    this.restoreRequested.emit(this.media);
  }

  get showTaggingSpinner(): boolean {
    return this.currentTaggingStatus === 'pending' || this.currentTaggingStatus === 'processing';
  }

  get statusLabel(): string {
    if (!this.media) {
      return '';
    }

    if (this.showTaggingSpinner) {
      return 'Processing';
    }

    return this.currentTaggingStatus;
  }

  private get currentTaggingStatus(): string {
    if (!this.media) {
      return '';
    }

    return this.mediaUploadService.getMediaTaggingStatus(this.media.id) ?? this.media.tagging_status;
  }

  private loadMedia(): void {
    if (!this.media) {
      return;
    }

    this.mediaRequestId += 1;
    const requestId = this.mediaRequestId;
    this.revokeMediaUrl();
    this.loading = true;
    this.failed = false;
    this.cdr.markForCheck();

    this.mediaClient.getMediaFile(this.media.id).subscribe({
      next: (blob) => {
        if (requestId !== this.mediaRequestId) {
          return;
        }
        this.mediaUrl = URL.createObjectURL(blob);
        this.loading = false;
        this.failed = false;
        this.cdr.markForCheck();
      },
      error: () => {
        if (requestId !== this.mediaRequestId) {
          return;
        }
        this.loading = false;
        this.failed = true;
        this.cdr.markForCheck();
      }
    });
  }

  private resetViewer(): void {
    this.mediaRequestId += 1;
    this.revokeMediaUrl();
    this.loading = false;
    this.failed = false;
    this.cdr.markForCheck();
  }

  private revokeMediaUrl(): void {
    if (!this.mediaUrl) {
      return;
    }

    URL.revokeObjectURL(this.mediaUrl);
    this.mediaUrl = null;
  }
}
