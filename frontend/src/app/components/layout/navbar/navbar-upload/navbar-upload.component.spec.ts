import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpEventType, HttpResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaService } from '../../../../services/media.service';
import { UploadTrackerService } from '../../../../services/upload-tracker.service';
import { ConfigClientService } from '../../../../services/web/config-client.service';
import { NavbarUploadComponent } from './navbar-upload.component';

describe('NavbarUploadComponent', () => {
  const originalCrypto = globalThis.crypto;
  const unsupportedUploadMessage = 'Only supported image, GIF, and video files can be uploaded.';

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });

  function toFileList(files: File[]): FileList {
    return {
      ...files,
      length: files.length,
      item: (index: number) => files[index] ?? null,
      [Symbol.iterator]: function* iterator() {
        yield* files;
      },
    } as FileList;
  }

  function dragEventWithFiles(files: File[]): DragEvent {
    return {
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ['Files'],
        files: toFileList(files),
        items: [],
      },
    } as unknown as DragEvent;
  }

  function makeDialogMock(result: Record<string, never> | undefined) {
    return {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(result),
      }),
    };
  }

  function uploadResponse(files: File[]) {
    return of(new HttpResponse({
      body: {
        batch_id: 'b1',
        batch_url: '/api/v1/me/import-batches/b1',
        batch_items_url: '/api/v1/me/import-batches/b1/items',
        poll_after_seconds: 2,
        webhooks_supported: false,
        accepted: files.length,
        duplicates: 0,
        errors: 0,
        results: [],
      },
      status: 200,
    }));
  }

  async function createComponent(overrides?: {
    upload?: ReturnType<typeof vi.fn>;
    dialogResult?: Record<string, never> | undefined;
    uploadConfig?: { max_batch_size: number };
    tracker?: {
      registerPendingBatch: ReturnType<typeof vi.fn>;
      markBatchUploading: ReturnType<typeof vi.fn>;
      registerBatchStarted: ReturnType<typeof vi.fn>;
      registerBatchRequestFailed: ReturnType<typeof vi.fn>;
      registerRejectedFiles: ReturnType<typeof vi.fn>;
    };
  }) {
    const upload =
      overrides?.upload ?? vi.fn().mockImplementation((files: File[]) => uploadResponse(files));

    // Default: dialog confirms with isPublic=false
    const dialogResult = 'dialogResult' in (overrides ?? {}) ? overrides!.dialogResult : {};
    const dialog = makeDialogMock(dialogResult);
    const uploadConfig = overrides?.uploadConfig ?? { max_batch_size: 1000 };
    const tracker = overrides?.tracker ?? {
      registerPendingBatch: vi.fn().mockReturnValue('request-1'),
      markBatchUploading: vi.fn(),
      registerBatchStarted: vi.fn(),
      registerBatchRequestFailed: vi.fn(),
      registerRejectedFiles: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [NavbarUploadComponent, NoopAnimationsModule],
      providers: [
        { provide: MediaService, useValue: { uploadWithProgress: upload } },
        {
          provide: ConfigClientService,
          useValue: { getUploadConfig: vi.fn().mockReturnValue(of(uploadConfig)) },
        },
        { provide: UploadTrackerService, useValue: tracker },
        { provide: MatDialog, useValue: dialog },
      ],
    }).compileComponents();

    vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockImplementation(() => undefined as never);
    const fixture = TestBed.createComponent(NavbarUploadComponent);
    fixture.detectChanges();

    return { fixture, component: fixture.componentInstance, upload, dialog, tracker };
  }

  function expectUploadWithVisibility(upload: ReturnType<typeof vi.fn>, files: File[]) {
    expect(upload).toHaveBeenCalledWith(
      files,
      expect.objectContaining({
        captured_at_values: expect.any(Array),
        idempotencyKey: expect.any(String),
      }),
    );
  }

  it('accepts newly supported files by MIME type and extension', async () => {
    const { component, upload } = await createComponent();
    const avif = new File(['avif'], 'cover.avif', { type: 'image/avif' });
    const bitmap = new File(['a'], 'scan.bmp', { type: 'image/bmp' });
    const matroska = new File(['b'], 'clip.mkv', { type: '' });

    component.onFileSelection(toFileList([avif, bitmap, matroska]));

    expect(upload).toHaveBeenCalledWith([avif, bitmap, matroska], expect.objectContaining({}));
  });

  it('splits uploads into configured max batch size chunks', async () => {
    const tracker = {
      registerPendingBatch: vi
        .fn()
        .mockReturnValueOnce('request-1')
        .mockReturnValueOnce('request-2'),
      markBatchUploading: vi.fn(),
      registerBatchStarted: vi.fn(),
      registerBatchRequestFailed: vi.fn(),
      registerRejectedFiles: vi.fn(),
    };
    const { component, upload } = await createComponent({
      tracker,
      uploadConfig: { max_batch_size: 2 },
    });
    const first = new File(['a'], 'first.webp', { type: 'image/webp' });
    const second = new File(['b'], 'second.webp', { type: 'image/webp' });
    const third = new File(['c'], 'third.webp', { type: 'image/webp' });

    component.onFileSelection(toFileList([first, second, third]));

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenNthCalledWith(1, [first, second], expect.objectContaining({}));
    expect(upload).toHaveBeenNthCalledWith(2, [third], expect.objectContaining({}));
  });

  it('flags unsupported-only selections as failed and does not upload them', async () => {
    const tracker = {
      registerPendingBatch: vi.fn().mockReturnValue('request-1'),
      markBatchUploading: vi.fn(),
      registerBatchStarted: vi.fn(),
      registerBatchRequestFailed: vi.fn(),
      registerRejectedFiles: vi.fn(),
    };
    const { component, upload } = await createComponent({ tracker });
    const illegal = new File(['x'], 'notes.txt', { type: 'text/plain' });

    component.onFileSelection(toFileList([illegal]));

    expect(upload).not.toHaveBeenCalled();
    expect(tracker.registerRejectedFiles).toHaveBeenCalledWith(
      [illegal],
      unsupportedUploadMessage,
    );
  });

  it('uploads the valid remainder when selections include unsupported files', async () => {
    const tracker = {
      registerPendingBatch: vi.fn().mockReturnValue('request-1'),
      markBatchUploading: vi.fn(),
      registerBatchStarted: vi.fn(),
      registerBatchRequestFailed: vi.fn(),
      registerRejectedFiles: vi.fn(),
    };
    const { component, upload } = await createComponent({ tracker });
    const valid = new File(['a'], 'okay.jpg', { type: 'image/jpeg' });
    const illegal = new File(['x'], 'notes.txt', { type: 'text/plain' });

    component.onFileSelection(toFileList([valid, illegal]));

    expect(upload).toHaveBeenCalledWith([valid], expect.objectContaining({}));
    expect(tracker.registerRejectedFiles).toHaveBeenCalledWith([illegal], unsupportedUploadMessage);
  });

  it('uploads folder selections with all legal files from the folder list', async () => {
    const { component, upload } = await createComponent();
    const first = new File(['a'], 'cover.png', { type: 'image/png' });
    const second = new File(['b'], 'nested/clip.webm', { type: 'video/webm' });

    component.onFolderSelection(toFileList([first, second]));

    expectUploadWithVisibility(upload, [first, second]);
  });

  it('shows and hides the drop overlay during drag lifecycle', async () => {
    const { component } = await createComponent();
    const file = new File(['a'], 'photo.png', { type: 'image/png' });

    component.onDragEnter(dragEventWithFiles([file]));
    expect(component.dragActive()).toBe(true);

    component.onDragLeave(dragEventWithFiles([file]));
    expect(component.dragActive()).toBe(false);
  });

  it('uploads files dropped onto the page', async () => {
    const { component, upload } = await createComponent();
    const first = new File(['a'], 'drop-one.png', { type: 'image/png' });
    const second = new File(['b'], 'drop-two.webp', { type: 'image/webp' });

    await component.onDrop(dragEventWithFiles([first, second]));

    expectUploadWithVisibility(upload, [first, second]);
  });

  it('collects files recursively from dropped folders', async () => {
    const { component, upload } = await createComponent();
    const nestedFile = new File(['a'], 'nested.png', { type: 'image/png' });

    const fileEntry = {
      isFile: true,
      isDirectory: false,
      file: (success: (file: File) => void) => success(nestedFile),
    } as unknown as FileSystemFileEntry;

    const directoryEntry = {
      isFile: false,
      isDirectory: true,
      createReader: () => {
        let called = false;
        return {
          readEntries: (success: (entries: FileSystemEntry[]) => void) => {
            if (called) {
              success([]);
              return;
            }
            called = true;
            success([fileEntry as unknown as FileSystemEntry]);
          },
        };
      },
    } as unknown as FileSystemDirectoryEntry;

    const dropEvent = {
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ['Files'],
        files: toFileList([]),
        items: [
          {
            webkitGetAsEntry: () => directoryEntry,
          },
        ],
      },
    } as unknown as DragEvent;

    await component.onDrop(dropEvent);

    expectUploadWithVisibility(upload, [nestedFile]);
  });

  it('falls back to dropped item files when directory entries are unavailable', async () => {
    const { component, upload } = await createComponent();
    const droppedFile = new File(['a'], 'dropped.webp', { type: 'image/webp' });

    const dropEvent = {
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ['Files'],
        files: toFileList([]),
        items: [
          {
            getAsFile: () => droppedFile,
          },
        ],
      },
    } as unknown as DragEvent;

    await component.onDrop(dropEvent);

    expectUploadWithVisibility(upload, [droppedFile]);
  });

  it('opens the confirm dialog with the correct file count', async () => {
    const { component, dialog } = await createComponent();
    const files = [
      new File(['a'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'two.jpg', { type: 'image/jpeg' }),
    ];

    component.onFileSelection(toFileList(files));

    expect(dialog.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: { fileCount: 2 } }),
    );
  });

  it('does not upload when the confirm dialog is cancelled', async () => {
    const { component, upload } = await createComponent({ dialogResult: undefined });
    const file = new File(['a'], 'photo.jpg', { type: 'image/jpeg' });

    component.onFileSelection(toFileList([file]));

    expect(upload).not.toHaveBeenCalled();
  });

  it('omits captured_at_values when a file does not expose a valid OS timestamp', async () => {
    const { component, upload } = await createComponent();
    const file = new File(['a'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'lastModified', { value: 0 });

    component.onFileSelection(toFileList([file]));

    expect(upload).toHaveBeenCalledWith([file], {
      idempotencyKey: expect.any(String),
    });
  });

  it('falls back to a generated idempotency key when randomUUID is unavailable', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });

    const { component, upload } = await createComponent();
    const file = new File(['a'], 'photo.jpg', { type: 'image/jpeg' });

    component.onFileSelection(toFileList([file]));

    expect(upload).toHaveBeenCalledWith(
      [file],
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^fallback-/),
      }),
    );
  });

  function pasteEventWithItems(items: { kind: string; type: string; getAsFile: () => File | null }[]): ClipboardEvent {
    return {
      clipboardData: { items },
    } as unknown as ClipboardEvent;
  }

  it('uploads an image pasted from the clipboard', async () => {
    const { component, upload } = await createComponent();
    const pasted = new File(['img'], 'image.png', { type: 'image/png' });

    component.onPaste(
      pasteEventWithItems([{ kind: 'file', type: 'image/png', getAsFile: () => pasted }]),
    );

    expectUploadWithVisibility(upload, [pasted]);
  });

  it('ignores paste events that contain only non-file clipboard items', async () => {
    const { component, upload } = await createComponent();

    component.onPaste(pasteEventWithItems([{ kind: 'string', type: 'text/plain', getAsFile: () => null }]));

    expect(upload).not.toHaveBeenCalled();
  });

  it('ignores paste events when clipboardData is null', async () => {
    const { component, upload } = await createComponent();

    component.onPaste({ clipboardData: null } as unknown as ClipboardEvent);

    expect(upload).not.toHaveBeenCalled();
  });
});
