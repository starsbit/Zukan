import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { MediaRead } from '../../models/api';
import { MediaClientService } from '../../services/web/media-client.service';

@Component({
  selector: 'app-gallery-media-card',
  imports: [CommonModule, DatePipe, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './gallery-media-card.component.html',
  styleUrl: './gallery-media-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryMediaCardComponent implements OnChanges, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly mediaClient = inject(MediaClientService);
  private thumbnailRequestId = 0;

  @Input({ required: true }) media!: MediaRead;
  @Input() selectionMode = false;
  @Input() selected = false;
  @Output() readonly open = new EventEmitter<MediaRead>();
  @Output() readonly selectionToggled = new EventEmitter<MediaRead>();

  thumbnailUrl: string | null = null;
  loadingThumbnail = false;
  thumbnailFailed = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['media'] && this.media) {
      this.loadThumbnail();
    }
  }

  ngOnDestroy(): void {
    this.revokeThumbnailUrl();
  }

  onCardClick(): void {
    if (this.selectionMode) {
      this.selectionToggled.emit(this.media);
      return;
    }

    this.open.emit(this.media);
  }

  onCardKeydown(event: Event): void {
    if (event instanceof KeyboardEvent) {
      event.preventDefault();
    }

    this.onCardClick();
  }

  toggleSelection(event: Event): void {
    event.stopPropagation();
    this.selectionToggled.emit(this.media);
  }

  get aspectRatio(): number {
    const width = this.media.metadata.width ?? 1;
    const height = this.media.metadata.height ?? 1;
    return width / height;
  }

  get showStatusBadge(): boolean {
    return this.media.tagging_status === 'pending' || this.media.tagging_status === 'processing';
  }

  get statusBadgeLabel(): string {
    return this.media.tagging_status === 'processing' ? 'Processing' : 'Pending';
  }

  get selectionLabel(): string {
    const name = this.media.original_filename || this.media.filename;
    return `${this.selected ? 'Unselect' : 'Select'} ${name}`;
  }

  private loadThumbnail(): void {
    this.thumbnailRequestId += 1;
    const requestId = this.thumbnailRequestId;
    this.revokeThumbnailUrl();
    this.loadingThumbnail = true;
    this.thumbnailFailed = false;
    this.cdr.markForCheck();

    if (this.media.thumbnail_status !== 'done') {
      this.loadingThumbnail = false;
      this.thumbnailFailed = true;
      this.cdr.markForCheck();
      return;
    }

    this.mediaClient.getMediaThumbnail(this.media.id).subscribe({
      next: (blob) => {
        if (requestId !== this.thumbnailRequestId) {
          return;
        }
        this.thumbnailUrl = URL.createObjectURL(blob);
        this.loadingThumbnail = false;
        this.thumbnailFailed = false;
        this.cdr.markForCheck();
      },
      error: () => {
        if (requestId !== this.thumbnailRequestId) {
          return;
        }
        this.loadingThumbnail = false;
        this.thumbnailFailed = true;
        this.cdr.markForCheck();
      }
    });
  }

  private revokeThumbnailUrl(): void {
    if (!this.thumbnailUrl) {
      return;
    }

    URL.revokeObjectURL(this.thumbnailUrl);
    this.thumbnailUrl = null;
  }
}
