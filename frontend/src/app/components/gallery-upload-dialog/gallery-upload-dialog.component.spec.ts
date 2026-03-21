import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';

import { GalleryUploadDialogComponent } from './gallery-upload-dialog.component';
import { MediaUploadService, type UploadSession } from '../../services/media-upload.service';

function createSession(overrides: Partial<UploadSession> = {}): UploadSession {
  return {
    phase: 'idle',
    visible: false,
    expanded: true,
    active: false,
    totalFiles: 0,
    uploadProgress: null,
    processingProgress: null,
    accepted: 0,
    duplicates: 0,
    errors: 0,
    completed: 0,
    items: [],
    errorMessage: null,
    ...overrides
  };
}

describe('GalleryUploadDialogComponent', () => {
  let fixture: ComponentFixture<GalleryUploadDialogComponent>;
  let component: GalleryUploadDialogComponent;
  let uploadService: {
    session$: BehaviorSubject<UploadSession>;
    startUpload: ReturnType<typeof vi.fn>;
  };
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    uploadService = {
      session$: new BehaviorSubject(createSession()),
      startUpload: vi.fn()
    };
    dialogRef = {
      close: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [GalleryUploadDialogComponent],
      providers: [
        { provide: MediaUploadService, useValue: uploadService },
        { provide: MatDialogRef, useValue: dialogRef }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryUploadDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('adds files from the file picker and starts upload', () => {
    const file = new File(['a'], 'upload.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    component.addSelectedFiles({ target: input } as unknown as Event);
    fixture.detectChanges();

    expect(component.selectedFiles).toEqual([file]);

    component.startUpload();

    expect(uploadService.startUpload).toHaveBeenCalledWith([file]);
  });

  it('formats small and large file sizes clearly for display', () => {
    expect(component.formatFileSize(23 * 1024)).toBe('23 KB');
    expect(component.formatFileSize(943 * 1024)).toBe('943 KB');
    expect(component.formatFileSize(Math.round(1.1 * 1024 * 1024))).toBe('1.1 MB');
    expect(component.formatFileSize(12 * 1024 * 1024)).toBe('12 MB');
    expect(component.formatFileSize(Math.round(1.6 * 1024 * 1024 * 1024))).toBe('1.6 GB');
    expect(component.formatFileSize(12 * 1024 * 1024 * 1024)).toBe('12 GB');
  });

  it('accepts drag and drop and removes selected files', () => {
    const file = new File(['a'], 'drop.png', { type: 'image/png' });
    component.onDrop({
      preventDefault: vi.fn(),
      dataTransfer: {
        files: [file],
        types: ['Files']
      }
    } as unknown as DragEvent);

    expect(component.selectedFiles).toEqual([file]);

    component.removeSelectedFile(0);
    expect(component.selectedFiles).toEqual([]);
  });

  it('renders current upload results and closes via the dialog ref', () => {
    uploadService.session$.next(createSession({
      phase: 'processing',
      visible: true,
      totalFiles: 1,
      accepted: 1,
      items: [{
        fileName: 'upload.png',
        size: 10,
        mimeType: 'image/png',
        status: 'processing',
        mediaId: 'media-1',
        message: null
      }]
    }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Upload status');
    expect(fixture.nativeElement.textContent).toContain('Processing');

    component.close();
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('never formats small files as 0 MB', () => {
    expect(component.formatFileSize(23 * 1024)).not.toContain('0');
    expect(component.formatFileSize(23 * 1024)).toBe('23 KB');
    expect(component.formatFileSize(21 * 1024)).toBe('21 KB');
    expect(component.formatFileSize(30 * 1024)).toBe('30 KB');
  });
});
