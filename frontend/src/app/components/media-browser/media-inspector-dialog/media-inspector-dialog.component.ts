import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MediaDetail, MediaRead, MediaType } from '../../../models/media';
import { MediaEntityType } from '../../../models/relations';
import { MediaService } from '../../../services/media.service';
import {
  formatConfidence,
  formatDateTime,
  formatDimensions,
  formatDuration,
  formatFileSize,
  formatMediaType,
  formatProcessingStatus,
  formatVisibility,
  humanizeBackendLabel,
} from '../../../utils/media-display.utils';

export interface MediaInspectorDialogData {
  media: MediaRead;
}

interface InspectorField {
  label: string;
  value: string;
}

@Component({
  selector: 'zukan-media-inspector-dialog',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './media-inspector-dialog.component.html',
  styleUrl: './media-inspector-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaInspectorDialogComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef<MediaInspectorDialogComponent>);
  protected readonly data = inject<MediaInspectorDialogData>(MAT_DIALOG_DATA);
  private readonly mediaService = inject(MediaService);
  private readonly zoomStage = viewChild<ElementRef<HTMLElement>>('zoomStage');

  readonly detail = signal<MediaDetail | null>(null);
  readonly mediaUrl = signal<string | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly dragging = signal(false);

  readonly media = computed(() => this.detail() ?? this.data.media);
  readonly title = computed(() => this.media().original_filename ?? this.media().filename);
  readonly isVideo = computed(() => this.media().media_type === MediaType.VIDEO);
  readonly isImage = computed(() => !this.isVideo());
  readonly imageTransform = computed(() => `translate(${this.panX()}px, ${this.panY()}px) scale(${this.zoom()})`);
  readonly metadataFields = computed<InspectorField[]>(() => {
    const media = this.media();
    return [
      { label: 'Filename', value: media.filename },
      { label: 'Original filename', value: media.original_filename ?? '' },
      { label: 'Media type', value: formatMediaType(media.media_type) },
      { label: 'MIME type', value: media.metadata.mime_type ?? '' },
      { label: 'Dimensions', value: formatDimensions(media.metadata.width, media.metadata.height) },
      { label: 'File size', value: formatFileSize(media.metadata.file_size) },
      { label: 'Duration', value: formatDuration(media.metadata.duration_seconds) },
      {
        label: 'Frame count',
        value: media.metadata.frame_count == null ? '' : `${media.metadata.frame_count}`,
      },
      { label: 'Captured at', value: formatDateTime(media.metadata.captured_at) },
      { label: 'Added at', value: formatDateTime(media.created_at) },
      { label: 'Visibility', value: formatVisibility(media.visibility) },
      { label: 'NSFW', value: media.is_nsfw ? 'Yes' : 'No' },
      { label: 'Tagging status', value: formatProcessingStatus(media.tagging_status) },
      { label: 'Thumbnail status', value: formatProcessingStatus(media.thumbnail_status) },
      { label: 'Poster status', value: formatProcessingStatus(media.poster_status) },
    ].filter((field) => field.value);
  });
  readonly authorFields = computed<InspectorField[]>(() => {
    const media = this.media();
    return [
      { label: 'Owner', value: media.owner_username ?? '' },
      { label: 'Uploaded by', value: media.uploader_username ?? '' },
    ].filter((field) => field.value);
  });
  readonly characters = computed(() =>
    (this.detail()?.entities ?? [])
      .filter((entity) => entity.entity_type === MediaEntityType.CHARACTER)
      .map((entity) => ({
        name: entity.name,
        details: [
          entity.role ? humanizeBackendLabel(entity.role) : '',
          entity.source ? humanizeBackendLabel(entity.source) : '',
          entity.confidence == null ? '' : `Confidence ${formatConfidence(entity.confidence)}`,
        ].filter(Boolean).join(' • '),
      })),
  );
  readonly externalRefs = computed(() =>
    (this.detail()?.external_refs ?? []).map((ref) => ({
      label: humanizeBackendLabel(ref.provider),
      value: ref.external_id ?? ref.url ?? '',
      url: ref.url,
    })),
  );
  readonly tags = computed(() => this.media().tags);
  readonly detectedText = computed(() => {
    const media = this.media();
    return media.ocr_text_override?.trim() || media.ocr_text?.trim() || '';
  });

  private objectUrl: string | null = null;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private panStartX = 0;
  private panStartY = 0;

  constructor() {
    this.mediaService.get(this.data.media.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.resetViewport();
          this.tryFinishLoading();
        },
        error: () => {
          this.loadError.set('Unable to load media details.');
          this.tryFinishLoading();
        },
      });

    this.mediaService.getFileUrl(this.data.media.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (url) => {
          this.revokeObjectUrl();
          this.objectUrl = url;
          this.mediaUrl.set(url);
          this.resetViewport();
          this.tryFinishLoading();
        },
        error: () => {
          this.loadError.set(this.loadError() || 'Unable to load the media file.');
          this.tryFinishLoading();
        },
      });
  }

  ngOnDestroy(): void {
    this.revokeObjectUrl();
  }

  close(): void {
    this.dialogRef.close();
  }

  onWheelZoom(event: WheelEvent): void {
    if (!this.isImage() || this.loading() || !this.mediaUrl()) {
      return;
    }

    event.preventDefault();
    this.applyZoom(this.zoom() + (-event.deltaY * 0.0015));
  }

  startPan(event: PointerEvent): void {
    if (!this.isImage() || this.zoom() <= 1) {
      return;
    }

    event.preventDefault();
    this.dragging.set(true);
    this.pointerStartX = event.clientX;
    this.pointerStartY = event.clientY;
    this.panStartX = this.panX();
    this.panStartY = this.panY();
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }

    const stage = this.zoomStage()?.nativeElement;
    if (!stage) {
      return;
    }

    const bounds = stage.getBoundingClientRect();
    const maxPanX = Math.max(0, ((bounds.width * this.zoom()) - bounds.width) / 2);
    const maxPanY = Math.max(0, ((bounds.height * this.zoom()) - bounds.height) / 2);
    this.panX.set(clampNumber(this.panStartX + event.clientX - this.pointerStartX, -maxPanX, maxPanX));
    this.panY.set(clampNumber(this.panStartY + event.clientY - this.pointerStartY, -maxPanY, maxPanY));
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  stopPan(): void {
    this.dragging.set(false);
  }

  trackByLabel(_: number, field: InspectorField): string {
    return field.label;
  }

  private tryFinishLoading(): void {
    const hasDetail = !!this.detail() || !!this.loadError();
    const hasMediaUrl = !!this.mediaUrl() || !!this.loadError();
    if (hasDetail && hasMediaUrl) {
      this.loading.set(false);
    }
  }

  private revokeObjectUrl(): void {
    if (!this.objectUrl) {
      return;
    }

    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  resetZoom(): void {
    this.applyZoom(1);
  }

  private applyZoom(value: number): void {
    const nextZoom = clampNumber(value, 1, 6);
    this.zoom.set(nextZoom);
    if (nextZoom <= 1) {
      this.panX.set(0);
      this.panY.set(0);
      this.dragging.set(false);
    }
  }

  private resetViewport(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
    this.dragging.set(false);
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
