import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';

import { GalleryUploadStatusIslandComponent } from './gallery-upload-status-island.component';
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

    await TestBed.configureTestingModule({
      imports: [GalleryUploadStatusIslandComponent],
      providers: [
        { provide: MediaUploadService, useValue: uploadService }
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
});
