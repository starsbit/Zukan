import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LayoutComponent } from './layout.component';
import { ThemeService } from '../../../services/theme.service';
import { UploadTrackerService } from '../../../services/upload-tracker.service';
import { LOCAL_STORAGE, SESSION_STORAGE } from '../../../services/web/auth.store';

const mockThemeService = {
  preference: () => 'system',
  cycle: () => {},
};

describe('LayoutComponent', () => {
  function storageStub(): Storage {
    return {
      length: 0,
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {},
      setItem: () => {},
    };
  }

  function uploadTrackerStub() {
    return {
      summary: () => ({
        requestCounts: { queued: 0, uploading: 0, completed: 0, failed: 0 },
        itemCounts: { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0, duplicate: 0, upload_error: 0 },
        totalTrackedItems: 0,
        completedItems: 0,
        progressPercent: 0,
        activeBatchCount: 0,
        hasActiveWork: false,
        latestBatch: null,
      }),
      countChips: () => [],
      visible: () => false,
      dismiss: () => {},
    };
  }

  it('renders the navbar and sidebar shell', async () => {
    await TestBed.configureTestingModule({
      imports: [LayoutComponent],
      providers: [
        provideRouter([]),
        { provide: ThemeService, useValue: mockThemeService },
        { provide: UploadTrackerService, useValue: uploadTrackerStub() },
        { provide: LOCAL_STORAGE, useValue: storageStub() },
        { provide: SESSION_STORAGE, useValue: storageStub() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LayoutComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('zukan-navbar')).not.toBeNull();
    expect(element.querySelector('zukan-sidebar')).not.toBeNull();
    expect(element.querySelector('zukan-navbar-brand')).not.toBeNull();
    expect(element.querySelector('zukan-upload-status-island')).not.toBeNull();
  });
});
