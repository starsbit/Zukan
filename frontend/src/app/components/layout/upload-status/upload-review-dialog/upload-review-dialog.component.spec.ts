import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../../../models/media';
import { UploadTrackerService } from '../../../../services/upload-tracker.service';
import { MediaService } from '../../../../services/media.service';
import { BatchesClientService } from '../../../../services/web/batches-client.service';
import { UploadReviewDialogComponent } from './upload-review-dialog.component';

describe('UploadReviewDialogComponent', () => {
  it('applies names to the selected media and refreshes the review queue', async () => {
    const refreshBatchReview = vi.fn();
    const tracker = {
      getBatchReview: signal({
        id: 'b1',
        reviewItems: [{
          batch_item_id: 'i1',
          source_filename: 'missing.jpg',
          missing_character: true,
          missing_series: true,
          entities: [],
          media: {
            id: 'm1',
            uploader_id: 'u1',
            uploader_username: 'uploader',
            owner_id: 'u1',
            owner_username: 'owner',
            visibility: MediaVisibility.PRIVATE,
            filename: 'missing.jpg',
            original_filename: 'missing.jpg',
            media_type: MediaType.IMAGE,
            metadata: {
              file_size: 1,
              width: 10,
              height: 10,
              duration_seconds: null,
              frame_count: null,
              mime_type: 'image/jpeg',
              captured_at: '2026-03-29T10:00:00Z',
            },
            version: 1,
            created_at: '2026-03-29T10:00:00Z',
            deleted_at: null,
            tags: [],
            ocr_text_override: null,
            is_nsfw: false,
            tagging_status: TaggingStatus.DONE,
            tagging_error: null,
            thumbnail_status: ProcessingStatus.DONE,
            poster_status: ProcessingStatus.NOT_APPLICABLE,
            ocr_text: null,
            is_favorited: false,
            favorite_count: 0,
          },
        }],
        reviewBaselineTotal: 1,
        reviewRefreshing: false,
      }),
      refreshBatchReview,
    };
    const batchUpdateEntities = vi.fn(() => of({ processed: 1, skipped: 0 }));
    const mediaService = {
      batchUpdateEntities,
      getCharacterSuggestions: vi.fn(() => of([])),
      getSeriesSuggestions: vi.fn(() => of([])),
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
    };

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: (batchId: string) => batchId === 'b1' ? tracker.getBatchReview() : null,
            refreshBatchReview,
          },
        },
        { provide: MediaService, useValue: mediaService },
        { provide: BatchesClientService, useValue: { listReviewItems: vi.fn(() => of({ total: 0, items: [] })) } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: 'b1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.toggleSelected('m1');
    component.addCharacter('Saber');
    component.addSeries('Fate/stay night');
    component.applySelected();

    expect(batchUpdateEntities).toHaveBeenCalledWith({
      media_ids: ['m1'],
      character_names: ['Saber'],
      series_names: ['Fate/stay night'],
    });
    expect(refreshBatchReview).toHaveBeenCalledWith('b1');
  });
});
