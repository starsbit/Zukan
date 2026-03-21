import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { MediaRead } from '../../models/api';
import { MediaUploadService } from '../../services/media-upload.service';
import { MediaClientService } from '../../services/web/media-client.service';

@Component({
  selector: 'app-gallery-media-card',
  imports: [CommonModule, DatePipe, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './gallery-media-card.component.html',
  styleUrl: './gallery-media-card.component.scss',
  host: {
    '[style.grid-column]': 'gridColumn',
    '[style.grid-row]': 'gridRow'
  },
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryMediaCardComponent implements OnChanges, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly mediaClient = inject(MediaClientService);
  private readonly mediaUploadService = inject(MediaUploadService);
  private thumbnailRequestId = 0;
  private previousMediaId: string | null = null;
  private previousThumbnailStatus: string | null = null;

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
      this.syncThumbnail();
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

  get gridColumn(): string {
    return `span ${this.columnSpan}`;
  }

  get gridRow(): string {
    return 'span 2';
  }

  get columnSpan(): number {
    return Math.min(6, Math.max(2, Math.round(this.aspectRatio * 2)));
  }

  get showStatusBadge(): boolean {
    return this.currentTaggingStatus === 'pending' || this.currentTaggingStatus === 'processing';
  }

  get statusBadgeLabel(): string {
    return this.currentTaggingStatus === 'processing' ? 'Processing' : 'Pending';
  }

  get selectionLabel(): string {
    const name = this.media.original_filename || this.media.filename;
    return `${this.selected ? 'Unselect' : 'Select'} ${name}`;
  }

  private get currentTaggingStatus(): string {
    return this.mediaUploadService.getMediaTaggingStatus(this.media.id) ?? this.media.tagging_status;
  }

  private syncThumbnail(): void {
    const mediaId = this.media.id;
    const thumbnailStatus = this.media.thumbnail_status;
    const mediaChanged = this.previousMediaId !== mediaId;
    const thumbnailStatusChanged = this.previousThumbnailStatus !== thumbnailStatus;

    this.previousMediaId = mediaId;
    this.previousThumbnailStatus = thumbnailStatus;

    if (!mediaChanged && !thumbnailStatusChanged) {
      return;
    }

    this.loadThumbnail();
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
