import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription } from 'rxjs';

import { MediaRead } from '../../models/api';
import { MediaUploadService } from '../../services/media-upload.service';
import { MediaClientService } from '../../services/web/media-client.service';

@Component({
  selector: 'app-gallery-media-card',
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './gallery-media-card.component.html',
  styleUrl: './gallery-media-card.component.scss',
  host: {
    '[style.--media-aspect-ratio]': 'aspectRatio'
  },
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryMediaCardComponent implements OnChanges, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly mediaClient = inject(MediaClientService);
  private readonly mediaUploadService = inject(MediaUploadService);
  private thumbnailRequestId = 0;
  private previewRequestId = 0;
  private previousMediaId: string | null = null;
  private previousThumbnailStatus: string | null = null;
  private previewRequestSub: Subscription | null = null;
  private previewVideoElement?: HTMLVideoElement;

  @ViewChild('previewVideo')
  set previewVideo(value: ElementRef<HTMLVideoElement> | undefined) {
    this.previewVideoElement = value?.nativeElement;

    if (this.previewVideoElement && this.previewActive && this.previewUrl && this.isVideo) {
      this.primeVideoPreview(this.previewVideoElement);
    }
  }

  @Input({ required: true }) media!: MediaRead;
  @Input() selectionMode = false;
  @Input() selected = false;
  @Input() trashMode = false;
  @Output() readonly open = new EventEmitter<MediaRead>();
  @Output() readonly selectionToggled = new EventEmitter<MediaRead>();
  @Output() readonly restoreRequested = new EventEmitter<MediaRead>();

  thumbnailUrl: string | null = null;
  loadingThumbnail = false;
  thumbnailFailed = false;
  previewUrl: string | null = null;
  previewActive = false;
  previewReady = false;
  loadingPreview = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['media'] && this.media) {
      this.resetPreviewState();
      this.syncThumbnail();
    }
  }

  ngOnDestroy(): void {
    this.cancelPreviewRequest();
    this.revokePreviewUrl();
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

  restoreMedia(event: Event): void {
    event.stopPropagation();
    this.restoreRequested.emit(this.media);
  }

  onPreviewEnter(): void {
    if (!this.canPreviewOnHover) {
      return;
    }

    this.previewActive = true;
    this.cdr.markForCheck();

    if (this.previewUrl) {
      this.startPreviewPlayback();
      return;
    }

    this.loadPreview();
  }

  onPreviewLeave(): void {
    if (!this.previewActive) {
      return;
    }

    this.previewActive = false;
    this.resetVideoPlayback();
    this.revokePreviewUrl();
    this.cancelPreviewRequest();
    this.loadingPreview = false;
    this.previewReady = false;
    this.cdr.markForCheck();
  }

  get aspectRatio(): number {
    const width = this.media.metadata.width ?? 1;
    const height = this.media.metadata.height ?? 1;
    return width / height;
  }

  get showStatusBadge(): boolean {
    return this.currentTaggingStatus === 'pending' || this.currentTaggingStatus === 'processing';
  }

  get showMediaTypeBadge(): boolean {
    return this.isVideo || this.isGif;
  }

  get mediaTypeLabel(): string {
    return this.isVideo ? formatDuration(this.media.metadata.duration_seconds) : 'GIF';
  }

  get mediaTypeIcon(): string {
    return this.isVideo ? 'play_circle' : 'gif_box';
  }

  get isVideo(): boolean {
    return this.media.media_type === 'video';
  }

  get isGif(): boolean {
    return !this.isVideo && (this.media.media_type === 'gif' || this.media.metadata.mime_type === 'image/gif');
  }

  get canPreviewOnHover(): boolean {
    return this.isVideo || this.isGif;
  }

  get showVideoPreview(): boolean {
    return this.previewActive && this.isVideo && !!this.previewUrl;
  }

  get showGifPreview(): boolean {
    return this.previewActive && this.isGif && !!this.previewUrl;
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

  onPreviewVideoLoaded(video: HTMLVideoElement): void {
    if (!this.previewActive) {
      return;
    }

    this.primeVideoPreview(video);
  }

  onPreviewVideoPlaying(): void {
    if (!this.previewActive || this.previewReady) {
      return;
    }

    this.previewReady = true;
    this.cdr.markForCheck();
  }

  private loadPreview(): void {
    this.previewRequestId += 1;
    const requestId = this.previewRequestId;
    this.cancelPreviewRequest();
    this.loadingPreview = true;
    this.cdr.markForCheck();

    this.previewRequestSub = this.mediaClient.getMediaFile(this.media.id).subscribe({
      next: (blob) => {
        if (requestId !== this.previewRequestId) {
          return;
        }

        this.revokePreviewUrl();
        this.previewUrl = URL.createObjectURL(blob);
        this.loadingPreview = false;
        this.previewReady = this.isGif;
        this.cdr.markForCheck();
        this.startPreviewPlayback();
      },
      error: () => {
        if (requestId !== this.previewRequestId) {
          return;
        }

        this.loadingPreview = false;
        this.previewActive = false;
        this.previewReady = false;
        this.cdr.markForCheck();
      }
    });
  }

  private startPreviewPlayback(): void {
    if (!this.previewActive || !this.isVideo) {
      return;
    }

    if (this.previewVideoElement) {
      this.primeVideoPreview(this.previewVideoElement);
    }
  }

  private resetVideoPlayback(): void {
    const video = this.previewVideoElement;
    if (!video) {
      return;
    }

    video.pause();
    video.currentTime = 0;
  }

  private resetPreviewState(): void {
    this.previewActive = false;
    this.loadingPreview = false;
    this.previewReady = false;
    this.cancelPreviewRequest();
    this.revokePreviewUrl();
  }

  private cancelPreviewRequest(): void {
    this.previewRequestSub?.unsubscribe();
    this.previewRequestSub = null;
  }

  private revokePreviewUrl(): void {
    if (!this.previewUrl) {
      return;
    }

    URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
  }

  private primeVideoPreview(video: HTMLVideoElement): void {
    if (!this.previewActive) {
      return;
    }

    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    if (video.currentTime !== 0) {
      video.currentTime = 0;
    }
    void video.play().catch(() => undefined);
  }
}

function formatDuration(durationSeconds: number | null | undefined): string {
  const totalSeconds = Math.max(0, Math.floor(durationSeconds ?? 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
