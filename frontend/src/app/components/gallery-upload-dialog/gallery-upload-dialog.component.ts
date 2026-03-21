import { AsyncPipe, TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { MediaUploadService } from '../../services/media-upload.service';

@Component({
  selector: 'app-gallery-upload-dialog',
  imports: [
    AsyncPipe,
    TitleCasePipe,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatIconModule,
    MatListModule,
    MatProgressBarModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './gallery-upload-dialog.component.html',
  styleUrl: './gallery-upload-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryUploadDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<GalleryUploadDialogComponent>);
  private readonly uploadService = inject(MediaUploadService);

  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  readonly session$ = this.uploadService.session$;
  selectedFiles: File[] = [];
  dragActive = false;

  openFilePicker(): void {
    this.fileInput?.nativeElement.click();
  }

  addSelectedFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFiles = [...this.selectedFiles, ...Array.from(input.files ?? [])];
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    this.dragActive = true;
  }

  onDragLeave(event: DragEvent): void {
    if ((event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
      return;
    }

    this.dragActive = false;
  }

  onDrop(event: DragEvent): void {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    this.dragActive = false;
    this.selectedFiles = [...this.selectedFiles, ...Array.from(event.dataTransfer?.files ?? [])];
  }

  removeSelectedFile(index: number): void {
    this.selectedFiles = this.selectedFiles.filter((_, currentIndex) => currentIndex !== index);
  }

  startUpload(): void {
    this.uploadService.startUpload(this.selectedFiles);
  }

  close(): void {
    this.dialogRef.close();
  }

  trackByFileName(index: number, file: File): string {
    return `${file.name}-${index}-${file.size}`;
  }

  formatFileSize(sizeInBytes: number): string {
    if (sizeInBytes < 1024 * 1024) {
      const kilobytes = Math.max(1, Math.round(sizeInBytes / 1024));
      return `${kilobytes} KB`;
    }

    if (sizeInBytes < 1024 * 1024 * 1024) {
      const megabytes = sizeInBytes / (1024 * 1024);
      const formattedMegabytes = megabytes >= 10
        ? Math.round(megabytes).toString()
        : megabytes.toFixed(1).replace(/\.0$/, '');

      return `${formattedMegabytes} MB`;
    }

    const gigabytes = sizeInBytes / (1024 * 1024 * 1024);
    const formattedGigabytes = gigabytes >= 10
      ? Math.round(gigabytes).toString()
      : gigabytes.toFixed(1).replace(/\.0$/, '');

    return `${formattedGigabytes} GB`;
  }
}

function containsFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
