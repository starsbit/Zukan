import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { CommonModule, DatePipe, DOCUMENT } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MediaRead } from '../../models/api';
import { MediaService } from '../../services/media.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { MediaClientService } from '../../services/web/media-client.service';
import { formatDisplayValue } from '../../utils/display-value.utils';
import { MediaTagEditorComponent, MediaTagEditorDraft } from '../media-tag-editor/media-tag-editor.component';

@Component({
  selector: 'app-gallery-viewer',
  imports: [CommonModule, DatePipe, MatButtonToggleModule, MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, MatProgressSpinnerModule, MediaTagEditorComponent],
  templateUrl: './gallery-viewer.component.html',
  styleUrl: './gallery-viewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryViewerComponent implements OnChanges, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly document = inject(DOCUMENT);
  private readonly mediaService = inject(MediaService);
  private readonly mediaClient = inject(MediaClientService);
  private readonly mediaUploadService = inject(MediaUploadService);
  private readonly snackBar = inject(MatSnackBar);
  private mediaRequestId = 0;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private panStartX = 0;
  private panStartY = 0;
  private previousBodyOverflow = '';
  private previousHtmlOverflow = '';
  private scrollLocked = false;

  @ViewChild('zoomStage') private zoomStage?: ElementRef<HTMLElement>;
  @Input() media: MediaRead | null = null;
  @Input() canRestore = false;
  @Input() canDelete = false;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly restoreRequested = new EventEmitter<MediaRead>();
  @Output() readonly deleteRequested = new EventEmitter<MediaRead>();
  @Output() readonly updated = new EventEmitter<MediaRead>();

  mediaUrl: string | null = null;
  loading = false;
  failed = false;
  tagsPanelOpen = false;
  editingMetadata = false;
  savingMetadata = false;
  zoom = 1;
  panX = 0;
  panY = 0;
  dragging = false;
  metadataDraft: MediaTagEditorDraft = {
    characterName: null,
    tags: []
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['media']) {
      if (this.media) {
        this.lockDocumentScroll();
        this.loadMedia();
      } else {
        this.resetViewer();
      }
    }
  }

  ngOnDestroy(): void {
    this.unlockDocumentScroll();
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

  deleteMedia(): void {
    if (!this.media) {
      return;
    }

    this.deleteRequested.emit(this.media);
  }

  restore(): void {
    if (!this.media) {
      return;
    }

    this.restoreRequested.emit(this.media);
  }

  toggleTagsPanel(): void {
    this.tagsPanelOpen = !this.tagsPanelOpen;
  }

  beginEditMetadata(): void {
    if (!this.media || !this.isImage) {
      return;
    }

    this.metadataDraft = {
      characterName: this.media.character_name ?? null,
      tags: [...this.media.tags]
    };
    this.editingMetadata = true;
    this.cdr.markForCheck();
  }

  cancelEditMetadata(): void {
    this.editingMetadata = false;
    this.metadataDraft = {
      characterName: this.media?.character_name ?? null,
      tags: [...(this.media?.tags ?? [])]
    };
    this.cdr.markForCheck();
  }

  updateMetadataDraft(draft: MediaTagEditorDraft): void {
    this.metadataDraft = draft;
  }

  saveMetadata(): void {
    if (!this.media || this.savingMetadata) {
      return;
    }

    this.savingMetadata = true;
    this.mediaService.updateMedia(this.media.id, {
      character_name: this.metadataDraft.characterName,
      tags: this.metadataDraft.tags
    }).subscribe({
      next: (media) => {
        this.media = media;
        this.metadataDraft = {
          characterName: media.character_name ?? null,
          tags: [...media.tags]
        };
        this.editingMetadata = false;
        this.savingMetadata = false;
        this.updated.emit(media);
        this.snackBar.open('Image tags updated.', 'Close', { duration: 3000 });
        this.cdr.markForCheck();
      },
      error: () => {
        this.savingMetadata = false;
        this.snackBar.open('Could not save image tags. Please try again.', 'Close', { duration: 3000 });
        this.cdr.markForCheck();
      }
    });
  }

  onWheelZoom(event: WheelEvent): void {
    if (!this.isImage || this.loading || this.failed || !this.mediaUrl) {
      return;
    }

    event.preventDefault();
    const delta = -event.deltaY * 0.0015;
    const nextZoom = clampNumber(this.zoom + delta, 1, 6);
    this.applyZoom(nextZoom);
  }

  startPan(event: PointerEvent): void {
    if (!this.isImage || this.zoom <= 1) {
      return;
    }

    this.dragging = true;
    this.pointerStartX = event.clientX;
    this.pointerStartY = event.clientY;
    this.panStartX = this.panX;
    this.panStartY = this.panY;
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.dragging || !this.zoomStage) {
      return;
    }

    const stage = this.zoomStage.nativeElement.getBoundingClientRect();
    const maxPanX = Math.max(0, ((stage.width * this.zoom) - stage.width) / 2);
    const maxPanY = Math.max(0, ((stage.height * this.zoom) - stage.height) / 2);

    this.panX = clampNumber(this.panStartX + event.clientX - this.pointerStartX, -maxPanX, maxPanX);
    this.panY = clampNumber(this.panStartY + event.clientY - this.pointerStartY, -maxPanY, maxPanY);
    this.cdr.markForCheck();
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  stopPan(): void {
    if (!this.dragging) {
      return;
    }

    this.dragging = false;
    this.cdr.markForCheck();
  }

  resetZoom(): void {
    this.applyZoom(1);
  }

  get isImage(): boolean {
    return !!this.media && this.media.media_type !== 'video';
  }

  get imageTransform(): string {
    return `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
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

    return formatDisplayValue(this.currentTaggingStatus);
  }

  formatDisplayValue(value: string | null | undefined): string {
    return formatDisplayValue(value);
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
    this.tagsPanelOpen = false;
    this.editingMetadata = false;
    this.savingMetadata = false;
    this.dragging = false;
    this.metadataDraft = {
      characterName: this.media.character_name ?? null,
      tags: [...this.media.tags]
    };
    this.resetZoomState();
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
    this.unlockDocumentScroll();
    this.revokeMediaUrl();
    this.loading = false;
    this.failed = false;
    this.tagsPanelOpen = false;
    this.editingMetadata = false;
    this.savingMetadata = false;
    this.dragging = false;
    this.metadataDraft = {
      characterName: null,
      tags: []
    };
    this.resetZoomState();
    this.cdr.markForCheck();
  }

  private revokeMediaUrl(): void {
    if (!this.mediaUrl) {
      return;
    }

    URL.revokeObjectURL(this.mediaUrl);
    this.mediaUrl = null;
  }

  private applyZoom(nextZoom: number): void {
    this.zoom = nextZoom;

    if (this.zoom <= 1) {
      this.panX = 0;
      this.panY = 0;
      this.dragging = false;
    }

    this.cdr.markForCheck();
  }

  private resetZoomState(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  private lockDocumentScroll(): void {
    if (this.scrollLocked) {
      return;
    }

    this.previousBodyOverflow = this.document.body.style.overflow;
    this.previousHtmlOverflow = this.document.documentElement.style.overflow;
    this.document.body.style.overflow = 'hidden';
    this.document.documentElement.style.overflow = 'hidden';
    this.scrollLocked = true;
  }

  private unlockDocumentScroll(): void {
    if (!this.scrollLocked) {
      return;
    }

    this.document.body.style.overflow = this.previousBodyOverflow;
    this.document.documentElement.style.overflow = this.previousHtmlOverflow;
    this.scrollLocked = false;
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
