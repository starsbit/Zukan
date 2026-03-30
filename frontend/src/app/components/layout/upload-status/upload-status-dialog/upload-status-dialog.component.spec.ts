import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { UploadStatusDialogComponent } from './upload-status-dialog.component';
import { UploadTrackerService } from '../../../../services/upload-tracker.service';
import { MediaService } from '../../../../services/media.service';

describe('UploadStatusDialogComponent', () => {
  it('renders filename, status, and error for the selected filter', async () => {
    const tracker = {
      summary: signal({
        requestCounts: { queued: 0, uploading: 0, completed: 1, failed: 0 },
        itemCounts: { pending: 0, processing: 0, done: 1, failed: 1, skipped: 0, duplicate: 0, upload_error: 0 },
        totalTrackedItems: 2,
        completedItems: 2,
        progressPercent: 100,
        activeBatchCount: 0,
        hasActiveWork: false,
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
    };

    await TestBed.configureTestingModule({
      imports: [UploadStatusDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: UploadTrackerService, useValue: tracker },
        { provide: MediaService, useValue: { getThumbnailUrl: vi.fn(), getPosterUrl: vi.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { initialFilter: 'failed', summary: tracker.summary() } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadStatusDialogComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('failed.jpg');
    expect(element.textContent).toContain('Poster generation failed');

    fixture.componentInstance.selectedFilter.set('done');
    fixture.detectChanges();

    expect(element.textContent).toContain('done.jpg');
  });
});
