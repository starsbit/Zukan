import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';

import { GalleryUploadStatusIslandComponent } from './gallery-upload-status-island.component';
import { GalleryUploadIssuesDialogComponent } from './gallery-upload-issues-dialog.component';
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

describe('GalleryUploadStatusIslandComponent', () => {
  let fixture: ComponentFixture<GalleryUploadStatusIslandComponent>;
  let uploadService: {
    session$: BehaviorSubject<UploadSession>;
    collapse: ReturnType<typeof vi.fn>;
    expand: ReturnType<typeof vi.fn>;
    dismissSession: ReturnType<typeof vi.fn>;
  };
  let dialog: { open: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    uploadService = {
      session$: new BehaviorSubject(createSession({
        phase: 'processing',
        visible: true,
        expanded: true,
        active: true,
        totalFiles: 3,
        accepted: 2,
        completed: 1,
        processingProgress: 50
      })),
      collapse: vi.fn(),
      expand: vi.fn(),
      dismissSession: vi.fn()
    };
    dialog = {
      open: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [GalleryUploadStatusIslandComponent],
      providers: [
        { provide: MediaUploadService, useValue: uploadService },
        { provide: MatDialog, useValue: dialog }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryUploadStatusIslandComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('renders the expanded island and forwards action clicks', () => {
    expect(fixture.nativeElement.textContent).toContain('3 files');
    expect(fixture.nativeElement.textContent).toContain('1 of 2 finished processing');

    const buttons = fixture.nativeElement.querySelectorAll('button');
    (buttons[0] as HTMLButtonElement).click();
    (buttons[1] as HTMLButtonElement).click();

    expect(uploadService.collapse).toHaveBeenCalled();
    expect(uploadService.dismissSession).toHaveBeenCalled();
  });

  it('renders the minimized trigger and re-expands on click', () => {
    uploadService.session$.next(createSession({
      phase: 'completed',
      visible: true,
      expanded: false,
      totalFiles: 1
    }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Upload complete');

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();

    expect(uploadService.expand).toHaveBeenCalled();
  });

  it('opens duplicate and error dialogs when meta chips are clicked', () => {
    uploadService.session$.next(createSession({
      phase: 'completed_with_errors',
      visible: true,
      expanded: true,
      totalFiles: 3,
      accepted: 1,
      duplicates: 1,
      errors: 1,
      items: [
        {
          fileName: 'dup-a.png',
          size: 100,
          mimeType: 'image/png',
          previewUrl: 'blob:dup-a',
          status: 'duplicate',
          mediaId: null,
          message: 'Media already exists'
        },
        {
          fileName: 'failed-b.png',
          size: 120,
          mimeType: 'image/png',
          previewUrl: 'blob:failed-b',
          status: 'failed',
          mediaId: 'media-2',
          message: 'Processing failed'
        },
        {
          fileName: 'ok-c.png',
          size: 120,
          mimeType: 'image/png',
          previewUrl: 'blob:ok-c',
          status: 'done',
          mediaId: 'media-3',
          message: null
        }
      ]
    }));
    fixture.detectChanges();

    const chips = Array.from(fixture.nativeElement.querySelectorAll('.status-chip')) as HTMLButtonElement[];
    expect(chips).toHaveLength(2);

    chips[0].click();
    expect(dialog.open).toHaveBeenCalledWith(GalleryUploadIssuesDialogComponent, expect.objectContaining({
      data: expect.objectContaining({
        title: 'Duplicate files',
        items: expect.arrayContaining([expect.objectContaining({ fileName: 'dup-a.png' })])
      })
    }));

    chips[1].click();
    expect(dialog.open).toHaveBeenCalledWith(GalleryUploadIssuesDialogComponent, expect.objectContaining({
      data: expect.objectContaining({
        title: 'Errors and processing failures',
        items: expect.arrayContaining([expect.objectContaining({ fileName: 'failed-b.png' })])
      })
    }));
  });

  it('formats underscored phase labels for display', () => {
    uploadService.session$.next(createSession({
      phase: 'completed_with_errors',
      visible: true,
      expanded: true,
      totalFiles: 2,
      accepted: 1,
      duplicates: 1,
      errors: 0
    }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Completed With Errors');
    expect(fixture.nativeElement.textContent).not.toContain('Completed_with_errors');
  });
});
