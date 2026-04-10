import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse, HttpEventType, HttpResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { EMPTY, catchError, concatMap, filter, finalize, from, map, of, reduce, retry, switchMap, tap, throwError, timer } from 'rxjs';
import { BatchUploadResponse } from '../../../../models/uploads';
import { MediaVisibility } from '../../../../models/media';
import { MediaService } from '../../../../services/media.service';
import { UploadTrackerService } from '../../../../services/upload-tracker.service';
import { ConfigClientService } from '../../../../services/web/config-client.service';
import { UploadConfirmDialogComponent, UploadConfirmDialogData, UploadConfirmDialogResult } from './upload-confirm-dialog/upload-confirm-dialog.component';
import { extractApiError } from '../../../../utils/api-error.utils';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.mp4',
  '.webm',
  '.mov',
]);

const DEFAULT_MAX_BATCH_SIZE = 1000;

@Component({
  selector: 'zukan-navbar-upload',
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatMenuModule, MatSnackBarModule],
  templateUrl: './navbar-upload.component.html',
  styleUrl: './navbar-upload.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavbarUploadComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly mediaService = inject(MediaService);
  private readonly configClient = inject(ConfigClientService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly uploadTracker = inject(UploadTrackerService);

  readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  readonly folderInput = viewChild.required<ElementRef<HTMLInputElement>>('folderInput');

  readonly loading = signal(false);
  readonly dragActive = signal(false);

  readonly accept = Array.from(new Set([...ALLOWED_MIME_TYPES, ...ALLOWED_EXTENSIONS])).join(',');
  private dragDepth = 0;

  openFilePicker(): void {
    this.fileInput().nativeElement.click();
  }

  openFolderPicker(): void {
    this.folderInput().nativeElement.click();
  }

  onFileSelection(fileList: FileList | null): void {
    this.handleSelection(Array.from(fileList ?? []), this.fileInput().nativeElement);
  }

  onFolderSelection(fileList: FileList | null): void {
    this.handleSelection(Array.from(fileList ?? []), this.folderInput().nativeElement);
  }

  @HostListener('document:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const items = Array.from(event.clipboardData?.items ?? []);
    const files = items
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (files.length === 0) {
      return;
    }

    this.handleSelection(files);
  }

  @HostListener('document:dragenter', ['$event'])
  onDragEnter(event: DragEvent): void {
    if (!this.hasFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    this.dragDepth += 1;
    this.dragActive.set(true);
  }

  @HostListener('document:dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    if (!this.hasFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.dragActive.set(true);
  }

  @HostListener('document:dragleave', ['$event'])
  onDragLeave(event: DragEvent): void {
    if (!this.hasFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) {
      this.dragActive.set(false);
    }
  }

  @HostListener('document:drop', ['$event'])
  async onDrop(event: DragEvent): Promise<void> {
    if (!this.hasFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    this.dragDepth = 0;
    this.dragActive.set(false);

    const files = await this.extractDroppedFiles(event.dataTransfer);
    this.handleSelection(files);
  }

  private handleSelection(files: File[], input?: HTMLInputElement): void {
    if (input) {
      input.value = '';
    }

    if (files.length === 0 || this.loading()) {
      return;
    }

    const uploadableFiles = files.filter((file) => this.isLegalFile(file));
    const unsupportedFiles = files.filter((file) => !this.isLegalFile(file));

    if (unsupportedFiles.length > 0) {
      this.uploadTracker.registerRejectedFiles(
        unsupportedFiles,
        'Only supported image and video files can be uploaded.',
      );
    }

    if (uploadableFiles.length === 0) {
      this.snackBar.open(
        `${unsupportedFiles.length} unsupported file${unsupportedFiles.length === 1 ? '' : 's'} flagged as failed`,
        'Close',
      );
      return;
    }

    this.dialog
      .open<UploadConfirmDialogComponent, UploadConfirmDialogData, UploadConfirmDialogResult>(
        UploadConfirmDialogComponent,
        { data: { fileCount: uploadableFiles.length }, panelClass: 'upload-confirm-dialog' },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.startUpload(uploadableFiles, result.isPublic);
        if (unsupportedFiles.length > 0) {
          this.snackBar.open(
            `${unsupportedFiles.length} unsupported file${unsupportedFiles.length === 1 ? '' : 's'} flagged as failed`,
            'Close',
            { duration: 5000 },
          );
        }
      });
  }

  private startUpload(files: File[], isPublic: boolean): void {
    const visibility = isPublic ? MediaVisibility.PUBLIC : MediaVisibility.PRIVATE;
    this.loading.set(true);
    this.configClient.getUploadConfig().pipe(
      map((config) => this.normalizeBatchSize(config.max_batch_size)),
      catchError(() => of(DEFAULT_MAX_BATCH_SIZE)),
      map((maxBatchSize) => this.chunkFiles(files, maxBatchSize)),
      switchMap((batches) => {
        const trackedRequests = batches.map((batch) => ({
          files: batch,
          requestId: this.uploadTracker.registerPendingBatch(batch, visibility),
        }));
        let activeTrackedRequest = trackedRequests[0]
          ? { ...trackedRequests[0], index: 0 }
          : null;

        return from(trackedRequests.entries()).pipe(
          concatMap(([index, { files: batch, requestId }]) => {
            activeTrackedRequest = { files: batch, requestId, index };
            this.uploadTracker.markBatchUploading(requestId);
            const idempotencyKey = crypto.randomUUID();
            return this.mediaService.uploadWithProgress(batch, {
              visibility,
              captured_at_values: this.getCapturedAtValues(batch),
              idempotencyKey,
            }).pipe(
              tap((event) => {
                if (event.type === HttpEventType.UploadProgress) {
                  this.uploadTracker.updateUploadProgress(requestId, event.loaded, event.total ?? 0);
                }
              }),
              filter((event): event is HttpResponse<BatchUploadResponse> => event.type === HttpEventType.Response),
              map((event) => event.body!),
              retry({
                count: 3,
                delay: (err: unknown, retryCount: number) => {
                  if (err instanceof HttpErrorResponse && err.status >= 400 && err.status < 500 && err.status !== 429) {
                    return throwError(() => err);
                  }
                  return timer(retryCount * 5000);
                },
              }),
              tap((response) => {
                this.uploadTracker.registerBatchStarted(requestId, response, batch, visibility);
              }),
              map((response) => response.accepted),
            );
          }),
          reduce((total, accepted) => total + accepted, 0),
          tap((accepted) => {
            this.snackBar.open(
              `Upload started for ${accepted} file${accepted === 1 ? '' : 's'}.`,
              'Close',
              { duration: 5000 },
            );
          }),
          catchError((err: unknown) => {
            const message = extractApiError(err, 'Unable to start upload.');
            if (activeTrackedRequest) {
              this.uploadTracker.registerBatchRequestFailed(
                activeTrackedRequest.requestId,
                activeTrackedRequest.files,
                message,
              );
              for (const pending of trackedRequests.slice(activeTrackedRequest.index + 1)) {
                this.uploadTracker.registerBatchRequestFailed(
                  pending.requestId,
                  [],
                  'Upload did not start because an earlier batch failed.',
                );
              }
            }
            this.snackBar.open(message, 'Close');
            return EMPTY;
          }),
        );
      }),
      finalize(() => this.loading.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();
  }

  private normalizeBatchSize(rawBatchSize: number): number {
    if (!Number.isFinite(rawBatchSize) || rawBatchSize <= 0) {
      return DEFAULT_MAX_BATCH_SIZE;
    }

    return Math.min(Math.floor(rawBatchSize), DEFAULT_MAX_BATCH_SIZE);
  }

  private chunkFiles(files: File[], maxBatchSize: number): File[][] {
    const batches: File[][] = [];
    for (let index = 0; index < files.length; index += maxBatchSize) {
      batches.push(files.slice(index, index + maxBatchSize));
    }
    return batches;
  }

  private hasFiles(dataTransfer: DataTransfer | null): boolean {
    if (!dataTransfer) {
      return false;
    }

    return Array.from(dataTransfer.types).includes('Files');
  }

  private async extractDroppedFiles(dataTransfer: DataTransfer | null): Promise<File[]> {
    if (!dataTransfer) {
      return [];
    }

    const items = Array.from(dataTransfer.items ?? []);
    const fileEntries = items
      .map((item) => this.entryFromItem(item))
      .filter((entry): entry is FileSystemEntry => entry !== null);
    const entryFiles = await Promise.all(fileEntries.map((entry) => this.readEntryFiles(entry)));

    const flattenedEntryFiles = entryFiles.flat();
    if (flattenedEntryFiles.length > 0) {
      return flattenedEntryFiles;
    }

    const itemFiles = items
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (itemFiles.length > 0) {
      return itemFiles;
    }

    return Array.from(dataTransfer.files ?? []);
  }

  private entryFromItem(item: DataTransferItem): FileSystemEntry | null {
    const candidate = item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntry | null;
      getAsEntry?: () => FileSystemEntry | null;
    };

    return candidate.webkitGetAsEntry?.() ?? candidate.getAsEntry?.() ?? null;
  }

  private async readEntryFiles(entry: FileSystemEntry): Promise<File[]> {
    if (entry.isFile) {
      return this.readFileEntry(entry as FileSystemFileEntry);
    }

    return this.readDirectoryEntry(entry as FileSystemDirectoryEntry);
  }

  private readFileEntry(entry: FileSystemFileEntry): Promise<File[]> {
    return new Promise((resolve) => {
      entry.file(
        (file) => resolve([file]),
        () => resolve([]),
      );
    });
  }

  private async readDirectoryEntry(entry: FileSystemDirectoryEntry): Promise<File[]> {
    const reader = entry.createReader();
    const children = await this.readAllDirectoryEntries(reader);
    const nestedFiles = await Promise.all(children.map((child) => this.readEntryFiles(child)));
    return nestedFiles.flat();
  }

  private async readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    const entries: FileSystemEntry[] = [];

    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(
          (result) => resolve(result),
          () => resolve([]),
        );
      });

      if (batch.length === 0) {
        return entries;
      }

      entries.push(...batch);
    }
  }

  private isLegalFile(file: File): boolean {
    if (ALLOWED_MIME_TYPES.has(file.type)) {
      return true;
    }

    const dotIndex = file.name.lastIndexOf('.');
    if (dotIndex === -1) {
      return false;
    }

    return ALLOWED_EXTENSIONS.has(file.name.slice(dotIndex).toLowerCase());
  }

  private getCapturedAtValues(files: File[]): string[] | undefined {
    const values = files.map((file) => this.toCapturedAtValue(file.lastModified));
    return values.every((value): value is string => value != null) ? values : undefined;
  }

  private toCapturedAtValue(lastModified: number): string | null {
    if (!Number.isFinite(lastModified) || lastModified <= 0) {
      return null;
    }

    return new Date(lastModified).toISOString();
  }
}
