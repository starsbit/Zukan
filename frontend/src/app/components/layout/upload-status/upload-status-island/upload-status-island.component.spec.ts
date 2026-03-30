import { signal } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { UploadStatusIslandComponent } from './upload-status-island.component';
import { MediaService } from '../../../../services/media.service';
import { UploadTrackerService } from '../../../../services/upload-tracker.service';

describe('UploadStatusIslandComponent', () => {
  it('stays hidden when there are no tracked uploads', async () => {
    const tracker = {
      summary: signal({
        requestCounts: { queued: 0, uploading: 0, completed: 0, failed: 0 },
        itemCounts: { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0, duplicate: 0, upload_error: 0 },
        totalTrackedItems: 0,
        completedItems: 0,
        progressPercent: 0,
        activeBatchCount: 0,
        hasActiveWork: false,
        latestBatch: null,
      }),
      itemsByFilter: signal({
        pending: [],
        processing: [],
        done: [],
        failed: [],
        skipped: [],
        duplicate: [],
        upload_error: [],
      }),
      countChips: signal([]),
      visible: signal(false),
      dismiss: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [UploadStatusIslandComponent, NoopAnimationsModule],
      providers: [
        { provide: UploadTrackerService, useValue: tracker },
        { provide: MediaService, useValue: { getThumbnailUrl: vi.fn(), getPosterUrl: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadStatusIslandComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('renders counts and opens the dialog for the clicked filter', async () => {
    const tracker = {
      summary: signal({
        requestCounts: { queued: 0, uploading: 1, completed: 1, failed: 0 },
        itemCounts: { pending: 2, processing: 1, done: 4, failed: 1, skipped: 0, duplicate: 1, upload_error: 0 },
        totalTrackedItems: 9,
        completedItems: 6,
        progressPercent: 67,
        activeBatchCount: 1,
        hasActiveWork: true,
        latestBatch: null,
      }),
      itemsByFilter: signal({
        pending: [],
        processing: [],
        done: [{
          id: 'done-1',
          filter: 'done',
          filename: 'done.jpg',
          error: null,
          previewMediaId: null,
          batchId: 'b1',
          statusLabel: 'Processed',
          stepLabel: 'Thumbnail',
          progressPercent: 100,
          updatedAt: '2026-03-29T10:00:00Z',
        }],
        failed: [{
          id: 'failed-1',
          filter: 'failed',
          filename: 'failed.jpg',
          error: 'Poster generation failed',
          previewMediaId: null,
          batchId: 'b1',
          statusLabel: 'Failed',
          stepLabel: 'Poster',
          progressPercent: 72,
          updatedAt: '2026-03-29T10:01:00Z',
        }],
        skipped: [],
        duplicate: [],
        upload_error: [],
      }),
      countChips: signal([
        { filter: 'done', label: 'Processed', count: 4 },
        { filter: 'failed', label: 'Failed', count: 1 },
      ]),
      visible: signal(true),
      dismiss: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [UploadStatusIslandComponent, NoopAnimationsModule],
      providers: [
        { provide: UploadTrackerService, useValue: tracker },
        { provide: MediaService, useValue: { getThumbnailUrl: vi.fn(), getPosterUrl: vi.fn() } },
      ],
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(UploadStatusIslandComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Uploading your batch to the gallery');
    expect(element.textContent).toContain('Processed');

    (element.querySelector('.count-chip') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(overlayContainer.getContainerElement().textContent).toContain('done.jpg');
  });

  it('uses generic processing copy when only retagged media is being tracked', async () => {
    const tracker = {
      summary: signal({
        requestCounts: { queued: 0, uploading: 0, completed: 0, failed: 0 },
        itemCounts: { pending: 1, processing: 1, done: 0, failed: 0, skipped: 0, duplicate: 0, upload_error: 0 },
        totalTrackedItems: 2,
        completedItems: 0,
        progressPercent: 0,
        activeBatchCount: 0,
        hasActiveWork: true,
        latestBatch: null,
      }),
      itemsByFilter: signal({
        pending: [],
        processing: [],
        done: [],
        failed: [],
        skipped: [],
        duplicate: [],
        upload_error: [],
      }),
      countChips: signal([
        { filter: 'pending', label: 'Pending', count: 1 },
        { filter: 'processing', label: 'Processing', count: 1 },
      ]),
      visible: signal(true),
      dismiss: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [UploadStatusIslandComponent, NoopAnimationsModule],
      providers: [
        { provide: UploadTrackerService, useValue: tracker },
        { provide: MediaService, useValue: { getThumbnailUrl: vi.fn(), getPosterUrl: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadStatusIslandComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Processing');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('2 files');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('0 requests finished');
  });
});
