import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { map } from 'rxjs';
import { MediaRead, MediaType } from '../../../models/media';
import { AlbumsClientService } from '../../../services/web/albums-client.service';
import { MediaCardComponent } from '../../media-browser/media-card/media-card.component';

export interface AlbumThumbnailDialogData {
  albumId: string;
  albumName: string;
  currentCoverMediaId: string | null;
}

export interface AlbumThumbnailDialogValue {
  coverMediaId: string | null;
  file?: File;
}

@Component({
  selector: 'zukan-album-thumbnail-dialog',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MediaCardComponent,
  ],
  templateUrl: './album-thumbnail-dialog.component.html',
  styleUrl: './album-thumbnail-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumThumbnailDialogComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly albumsClient = inject(AlbumsClientService);
  private readonly dialogRef = inject(MatDialogRef<AlbumThumbnailDialogComponent, AlbumThumbnailDialogValue>);

  protected readonly data = inject<AlbumThumbnailDialogData>(MAT_DIALOG_DATA);

  readonly loading = signal(true);
  readonly mediaItems = signal<MediaRead[]>([]);
  readonly selectedMediaId = signal<string | null>(this.data.currentCoverMediaId);
  readonly selectedFile = signal<File | null>(null);
  readonly uploadPreviewUrl = signal<string | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly hasExistingOptions = computed(() => this.mediaItems().length > 0);
  readonly hasCurrentCover = computed(() => !!this.data.currentCoverMediaId);
  readonly hasUploadSelection = computed(() => !!this.selectedFile());

  constructor() {
    this.albumsClient.listMedia(this.data.albumId, { page_size: 200 })
      .pipe(
        map((page) => page.items.filter((item) => item.media_type === MediaType.IMAGE || item.media_type === MediaType.GIF)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (items) => {
          this.mediaItems.set(items);
          this.loading.set(false);
        },
        error: () => {
          this.mediaItems.set([]);
          this.loading.set(false);
        },
      });
  }

  selectExisting(mediaId: string): void {
    this.selectedMediaId.set(mediaId);
    this.clearFileSelection();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.clearFileSelection();
      this.fileError.set('Choose an image file to use as the album thumbnail.');
      if (input) {
        input.value = '';
      }
      return;
    }

    this.fileError.set(null);
    this.selectedMediaId.set(null);
    const previousUrl = this.uploadPreviewUrl();
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
    }
    this.selectedFile.set(file);
    this.uploadPreviewUrl.set(URL.createObjectURL(file));
    if (input) {
      input.value = '';
    }
  }

  clearToDefault(): void {
    this.dialogRef.close({ coverMediaId: null });
  }

  save(): void {
    const file = this.selectedFile();
    if (file) {
      this.dialogRef.close({
        coverMediaId: null,
        file,
      });
      return;
    }

    const mediaId = this.selectedMediaId();
    if (!mediaId) {
      return;
    }

    this.dialogRef.close({
      coverMediaId: mediaId,
    });
  }

  ngOnDestroy(): void {
    this.clearObjectUrl();
  }

  private clearFileSelection(): void {
    this.selectedFile.set(null);
    this.fileError.set(null);
    this.clearObjectUrl();
  }

  private clearObjectUrl(): void {
    const previewUrl = this.uploadPreviewUrl();
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      this.uploadPreviewUrl.set(null);
    }
  }
}
