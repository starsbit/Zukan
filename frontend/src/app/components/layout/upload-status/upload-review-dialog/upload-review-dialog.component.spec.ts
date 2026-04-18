import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../../../models/media';
import { ImportBatchReviewListResponse } from '../../../../models/processing';
import { UploadTrackerService } from '../../../../services/upload-tracker.service';
import { MediaService } from '../../../../services/media.service';
import { BatchesClientService } from '../../../../services/web/batches-client.service';
import { UploadReviewDialogComponent } from './upload-review-dialog.component';

describe('UploadReviewDialogComponent', () => {
  it('applies names to the selected media and refreshes the review queue', async () => {
    const refreshBatchReview = vi.fn();
    const refreshBatchRecommendations = vi.fn();
    const tracker = {
      getBatchReview: signal({
        id: 'b1',
        recommendationGroups: [],
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
            uploaded_at: '2026-03-29T10:00:00Z',
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
        recommendationsRefreshing: false,
      }),
      refreshBatchReview,
      refreshBatchRecommendations,
    };
    const batchUpdateEntities = vi.fn(() => of({ processed: 1, skipped: 0 }));
    const mediaService = {
      batchUpdateEntities,
      batchDismissMetadataReview: vi.fn(() => of({ processed: 1, skipped: 0 })),
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
            refreshBatchRecommendations,
          },
        },
        { provide: MediaService, useValue: mediaService },
        { provide: BatchesClientService, useValue: { listReviewItems: vi.fn(() => of({ total: 0, items: [], recommendation_groups: [] })) } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: 'b1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.toggleSelected('m1');
    component.addCharacter('Saber Alter');
    component.addSeries('Little Busters');
    component.applySelected();

    expect(batchUpdateEntities).toHaveBeenCalledWith({
      media_ids: ['m1'],
      character_names: ['saber_alter'],
      series_names: ['little_busters'],
    });
    expect(refreshBatchReview).toHaveBeenCalledWith('b1');
    expect(refreshBatchRecommendations).toHaveBeenNthCalledWith(1, 'b1', false);
    expect(refreshBatchRecommendations).toHaveBeenCalledTimes(1);
  });

  it('defaults to grouped recommendations and lets suggestions prefill naming chips', async () => {
    const refreshBatchReview = vi.fn();
    const refreshBatchRecommendations = vi.fn();
    const tracker = {
      getBatchReview: signal({
        id: 'b1',
        recommendationGroups: [{
          id: 'group-1',
          media_ids: ['m1', 'm2'],
          item_count: 2,
          missing_character_count: 2,
          missing_series_count: 2,
          suggested_characters: [{ name: 'artoria_pendragon_(fate)', confidence: 0.95 }],
          suggested_series: [{ name: 'fate_stay_night', confidence: 0.91 }],
          shared_signals: [{ kind: 'tag', label: 'ryuuguu_rena', confidence: 0.8 }],
          confidence: 0.82,
        }],
        reviewItems: [
          {
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
              uploaded_at: '2026-03-29T10:00:00Z',
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
          },
          {
            batch_item_id: 'i2',
            source_filename: 'missing-2.jpg',
            missing_character: true,
            missing_series: true,
            entities: [],
            media: {
              id: 'm2',
              uploader_id: 'u1',
              uploader_username: 'uploader',
              owner_id: 'u1',
              owner_username: 'owner',
              visibility: MediaVisibility.PRIVATE,
              filename: 'missing-2.jpg',
              original_filename: 'missing-2.jpg',
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
              uploaded_at: '2026-03-29T10:00:00Z',
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
          },
        ],
        reviewBaselineTotal: 2,
        reviewRefreshing: false,
        recommendationsRefreshing: false,
      }),
      refreshBatchReview,
      refreshBatchRecommendations,
    };

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: (batchId: string) => batchId === 'b1' ? tracker.getBatchReview() : null,
            refreshBatchReview,
            refreshBatchRecommendations,
          },
        },
        {
          provide: MediaService,
          useValue: {
            batchUpdateEntities: vi.fn(() => of({ processed: 1, skipped: 0 })),
            batchDismissMetadataReview: vi.fn(() => of({ processed: 1, skipped: 0 })),
            getCharacterSuggestions: vi.fn(() => of([])),
            getSeriesSuggestions: vi.fn(() => of([])),
            getThumbnailUrl: vi.fn(() => of('blob:thumb')),
            getPosterUrl: vi.fn(() => of('blob:poster')),
          },
        },
        { provide: BatchesClientService, useValue: { listReviewItems: vi.fn(() => of({ total: 0, items: [], recommendation_groups: [] })) } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: 'b1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.view()).toBe('groups');
    expect(fixture.nativeElement.textContent).toContain('tag: Ryuuguu Rena');
    expect(fixture.nativeElement.textContent).toContain('Artoria Pendragon (Fate)');
    expect(fixture.nativeElement.textContent).toContain('Fate Stay Night');

    component.toggleGroupSelection(component.recommendationGroups()[0]);
    component.useCharacterSuggestion('artoria_pendragon_(fate)');
    component.useSeriesSuggestion('fate_stay_night');

    expect(component.selectedIds().sort()).toEqual(['m1', 'm2']);
    expect(component.characterNames()).toEqual(['artoria_pendragon_(fate)']);
    expect(component.seriesNames()).toEqual(['fate_stay_night']);

    component.toggleGroupSelection(component.recommendationGroups()[0]);
    expect(component.selectedIds()).toEqual([]);
  });

  it('allows removing items from a recommendation group', async () => {
    const refreshBatchReview = vi.fn();
    const refreshBatchRecommendations = vi.fn();
    const tracker = {
      getBatchReview: signal({
        id: 'b1',
        recommendationGroups: [{
          id: 'group-1',
          media_ids: ['m1', 'm2'],
          item_count: 2,
          missing_character_count: 2,
          missing_series_count: 2,
          suggested_characters: [{ name: 'Saber', confidence: 0.95 }],
          suggested_series: [],
          shared_signals: [{ kind: 'tag', label: 'blue dress', confidence: 0.8 }],
          confidence: 0.82,
        }],
        reviewItems: [
          {
            batch_item_id: 'i1',
            source_filename: 'one.jpg',
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
              filename: 'one.jpg',
              original_filename: 'one.jpg',
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
              uploaded_at: '2026-03-29T10:00:00Z',
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
          },
          {
            batch_item_id: 'i2',
            source_filename: 'two.jpg',
            missing_character: true,
            missing_series: true,
            entities: [],
            media: {
              id: 'm2',
              uploader_id: 'u1',
              uploader_username: 'uploader',
              owner_id: 'u1',
              owner_username: 'owner',
              visibility: MediaVisibility.PRIVATE,
              filename: 'two.jpg',
              original_filename: 'two.jpg',
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
              uploaded_at: '2026-03-29T10:00:00Z',
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
          },
        ],
        reviewBaselineTotal: 2,
        reviewRefreshing: false,
        recommendationsRefreshing: false,
      }),
      refreshBatchReview,
      refreshBatchRecommendations,
    };

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: (batchId: string) => batchId === 'b1' ? tracker.getBatchReview() : null,
            refreshBatchReview,
            refreshBatchRecommendations,
          },
        },
        {
          provide: MediaService,
          useValue: {
            batchUpdateEntities: vi.fn(() => of({ processed: 1, skipped: 0 })),
            batchDismissMetadataReview: vi.fn(() => of({ processed: 1, skipped: 0 })),
            getCharacterSuggestions: vi.fn(() => of([])),
            getSeriesSuggestions: vi.fn(() => of([])),
            getThumbnailUrl: vi.fn(() => of('blob:thumb')),
            getPosterUrl: vi.fn(() => of('blob:poster')),
          },
        },
        { provide: BatchesClientService, useValue: { listReviewItems: vi.fn(() => of({ total: 0, items: [], recommendation_groups: [] })) } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: 'b1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.recommendationGroups()).toHaveLength(1);

    component.discardItemFromGroup(component.recommendationGroups()[0], 'm1');
    await Promise.resolve();
    expect(component.recommendationGroups()).toHaveLength(0);
    expect(component.ungroupedVisibleItems().map((item) => item.media.id)).toEqual(['m2']);
  });

  it('discards an entire group from review', async () => {
    const refreshBatchReview = vi.fn();
    const refreshBatchRecommendations = vi.fn();
    const batchDismissMetadataReview = vi.fn(() => of({ processed: 2, skipped: 0 }));
    const tracker = {
      getBatchReview: signal({
        id: 'b1',
        recommendationGroups: [{
          id: 'group-1',
          media_ids: ['m1', 'm2'],
          item_count: 2,
          missing_character_count: 2,
          missing_series_count: 2,
          suggested_characters: [],
          suggested_series: [],
          shared_signals: [],
          confidence: 0.82,
        }],
        reviewItems: [
          {
            batch_item_id: 'i1',
            source_filename: 'one.jpg',
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
              filename: 'one.jpg',
              original_filename: 'one.jpg',
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
              uploaded_at: '2026-03-29T10:00:00Z',
              deleted_at: null,
              tags: [],
              ocr_text_override: null,
              metadata_review_dismissed: false,
              is_nsfw: false,
              tagging_status: TaggingStatus.DONE,
              tagging_error: null,
              thumbnail_status: ProcessingStatus.DONE,
              poster_status: ProcessingStatus.NOT_APPLICABLE,
              ocr_text: null,
              is_favorited: false,
              favorite_count: 0,
            },
          },
          {
            batch_item_id: 'i2',
            source_filename: 'two.jpg',
            missing_character: true,
            missing_series: true,
            entities: [],
            media: {
              id: 'm2',
              uploader_id: 'u1',
              uploader_username: 'uploader',
              owner_id: 'u1',
              owner_username: 'owner',
              visibility: MediaVisibility.PRIVATE,
              filename: 'two.jpg',
              original_filename: 'two.jpg',
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
              uploaded_at: '2026-03-29T10:00:00Z',
              deleted_at: null,
              tags: [],
              ocr_text_override: null,
              metadata_review_dismissed: false,
              is_nsfw: false,
              tagging_status: TaggingStatus.DONE,
              tagging_error: null,
              thumbnail_status: ProcessingStatus.DONE,
              poster_status: ProcessingStatus.NOT_APPLICABLE,
              ocr_text: null,
              is_favorited: false,
              favorite_count: 0,
            },
          },
        ],
        reviewBaselineTotal: 2,
        reviewRefreshing: false,
        recommendationsRefreshing: false,
      }),
      refreshBatchReview,
      refreshBatchRecommendations,
    };

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: (batchId: string) => batchId === 'b1' ? tracker.getBatchReview() : null,
            refreshBatchReview,
            refreshBatchRecommendations,
          },
        },
        {
          provide: MediaService,
          useValue: {
            batchUpdateEntities: vi.fn(() => of({ processed: 1, skipped: 0 })),
            batchDismissMetadataReview,
            getCharacterSuggestions: vi.fn(() => of([])),
            getSeriesSuggestions: vi.fn(() => of([])),
            getThumbnailUrl: vi.fn(() => of('blob:thumb')),
            getPosterUrl: vi.fn(() => of('blob:poster')),
          },
        },
        { provide: BatchesClientService, useValue: { listReviewItems: vi.fn(() => of({ total: 0, items: [], recommendation_groups: [] })) } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: 'b1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.discardGroup(component.recommendationGroups()[0]);
    await Promise.resolve();

    expect(batchDismissMetadataReview).toHaveBeenCalledWith(['m1', 'm2'], true);
    expect(refreshBatchReview).toHaveBeenCalledWith('b1');
  });

  it('loads recommendations in the background without blocking visible items', async () => {
    const reviewItemsResponse: ImportBatchReviewListResponse = {
      total: 1,
      recommendation_groups: [],
      items: [{
        batch_item_id: 'i1',
        source_filename: 'missing.jpg',
        missing_character: true,
        missing_series: false,
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
          uploaded_at: '2026-03-29T10:00:00Z',
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
    };
    const recommendations$ = new Subject<ImportBatchReviewListResponse>();
    const listReviewItems = vi.fn()
      .mockReturnValueOnce(of(reviewItemsResponse))
      .mockReturnValueOnce(recommendations$);

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: () => null,
            refreshBatchReview: vi.fn(),
            refreshBatchRecommendations: vi.fn(),
          },
        },
        {
          provide: MediaService,
          useValue: {
            batchUpdateEntities: vi.fn(() => of({ processed: 1, skipped: 0 })),
            batchDismissMetadataReview: vi.fn(() => of({ processed: 1, skipped: 0 })),
            getCharacterSuggestions: vi.fn(() => of([])),
            getSeriesSuggestions: vi.fn(() => of([])),
            getThumbnailUrl: vi.fn(() => of('blob:thumb')),
            getPosterUrl: vi.fn(() => of('blob:poster')),
          },
        },
        { provide: BatchesClientService, useValue: { listReviewItems } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: 'b1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    expect(listReviewItems).toHaveBeenNthCalledWith(1, 'b1');
    expect(listReviewItems).toHaveBeenNthCalledWith(2, 'b1', {
      include_recommendations: true,
      force_refresh: false,
    });
    expect(fixture.componentInstance.items()).toHaveLength(1);
    expect(fixture.componentInstance.recommendationsRefreshing()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Refreshing recommendations');

    recommendations$.next({
      ...reviewItemsResponse,
      recommendation_groups: [{
        id: 'group-1',
        media_ids: ['m1', 'm2'],
        item_count: 2,
        missing_character_count: 2,
        missing_series_count: 1,
        suggested_characters: [{ name: 'Saber', confidence: 0.95 }],
        suggested_series: [{ name: 'Fate/stay night', confidence: 1 }],
        shared_signals: [],
        confidence: 0.91,
      }],
      items: [
        ...reviewItemsResponse.items,
        {
          ...reviewItemsResponse.items[0],
          batch_item_id: 'i2',
          media: { ...reviewItemsResponse.items[0].media, id: 'm2', filename: 'missing-2.jpg', original_filename: 'missing-2.jpg' },
          source_filename: 'missing-2.jpg',
          missing_character: true,
          missing_series: true,
        },
      ],
      total: 2,
    });
    recommendations$.complete();
    fixture.detectChanges();

    expect(fixture.componentInstance.recommendationGroups()).toHaveLength(1);
    expect(fixture.componentInstance.recommendationsRefreshing()).toBe(false);
  });

  it('shows the merge-all button for single-batch dialogs', async () => {
    const listReviewItems = vi.fn()
      .mockReturnValueOnce(of({ total: 0, items: [], recommendation_groups: [] }))
      .mockReturnValueOnce(of({ total: 0, items: [], recommendation_groups: [] }));

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: () => null,
            refreshBatchReview: vi.fn(),
            refreshBatchRecommendations: vi.fn(),
          },
        },
        {
          provide: MediaService,
          useValue: {
            batchUpdateEntities: vi.fn(() => of({ processed: 1, skipped: 0 })),
            batchDismissMetadataReview: vi.fn(() => of({ processed: 1, skipped: 0 })),
            getCharacterSuggestions: vi.fn(() => of([])),
            getSeriesSuggestions: vi.fn(() => of([])),
            getThumbnailUrl: vi.fn(() => of('blob:thumb')),
            getPosterUrl: vi.fn(() => of('blob:poster')),
          },
        },
        { provide: BatchesClientService, useValue: { listReviewItems, listAllReviewItems: vi.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: 'b1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Merge all batches & regroup');
  });

  it('hides the merge-all button for all-pending dialogs', async () => {
    const listAllReviewItems = vi.fn().mockReturnValue(of({ total: 0, items: [], recommendation_groups: [] }));

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: () => null,
            refreshBatchReview: vi.fn(),
            refreshBatchRecommendations: vi.fn(),
          },
        },
        {
          provide: MediaService,
          useValue: {
            batchUpdateEntities: vi.fn(() => of({ processed: 1, skipped: 0 })),
            batchDismissMetadataReview: vi.fn(() => of({ processed: 1, skipped: 0 })),
            getCharacterSuggestions: vi.fn(() => of([])),
            getSeriesSuggestions: vi.fn(() => of([])),
            getThumbnailUrl: vi.fn(() => of('blob:thumb')),
            getPosterUrl: vi.fn(() => of('blob:poster')),
          },
        },
        { provide: BatchesClientService, useValue: { listReviewItems: vi.fn(), listAllReviewItems } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: null } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    expect(listAllReviewItems).toHaveBeenCalledWith({ include_recommendations: true });
    expect(fixture.nativeElement.textContent).not.toContain('Merge all batches & regroup');
  });

  it('switches to all-pending scope and keeps refreshing through listAllReviewItems', async () => {
    const baseMedia = {
      uploader_id: 'u1',
      uploader_username: 'uploader',
      owner_id: 'u1',
      owner_username: 'owner',
      visibility: MediaVisibility.PRIVATE,
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
      uploaded_at: '2026-03-29T10:00:00Z',
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
    };
    const batchItems = ['m1', 'm2'].map((id, index) => ({
      batch_item_id: `batch-${index + 1}`,
      source_filename: `${id}.jpg`,
      missing_character: true,
      missing_series: true,
      entities: [],
      media: {
        ...baseMedia,
        id,
        filename: `${id}.jpg`,
        original_filename: `${id}.jpg`,
      },
    }));
    const allPendingResponse = {
      total: 4,
      items: ['m1', 'm2', 'm3', 'm4'].map((id, index) => ({
        batch_item_id: `all-${index + 1}`,
        source_filename: `${id}.jpg`,
        missing_character: true,
        missing_series: true,
        entities: [],
        media: {
          ...baseMedia,
          id,
          filename: `${id}.jpg`,
          original_filename: `${id}.jpg`,
        },
      })),
      recommendation_groups: [
        {
          id: 'group-1',
          media_ids: ['m1', 'm2'],
          item_count: 2,
          missing_character_count: 2,
          missing_series_count: 2,
          suggested_characters: [{ name: 'Saber', confidence: 0.9 }],
          suggested_series: [],
          shared_signals: [],
          confidence: 0.91,
        },
        {
          id: 'group-2',
          media_ids: ['m3', 'm4'],
          item_count: 2,
          missing_character_count: 2,
          missing_series_count: 2,
          suggested_characters: [{ name: 'Rin', confidence: 0.88 }],
          suggested_series: [],
          shared_signals: [],
          confidence: 0.87,
        },
      ],
    } satisfies ImportBatchReviewListResponse;
    const listReviewItems = vi.fn()
      .mockReturnValueOnce(of({ total: 2, items: batchItems, recommendation_groups: [] }))
      .mockReturnValueOnce(of({
        total: 2,
        items: batchItems,
        recommendation_groups: [{
          id: 'group-1',
          media_ids: ['m1', 'm2'],
          item_count: 2,
          missing_character_count: 2,
          missing_series_count: 2,
          suggested_characters: [{ name: 'Saber', confidence: 0.9 }],
          suggested_series: [],
          shared_signals: [],
          confidence: 0.91,
        }],
      }));
    const allPending$ = new Subject<ImportBatchReviewListResponse>();
    const listAllReviewItems = vi.fn()
      .mockReturnValueOnce(allPending$)
      .mockReturnValueOnce(of(allPendingResponse));
    const refreshBatchRecommendations = vi.fn();

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: () => null,
            refreshBatchReview: vi.fn(),
            refreshBatchRecommendations,
          },
        },
        {
          provide: MediaService,
          useValue: {
            batchUpdateEntities: vi.fn(() => of({ processed: 1, skipped: 0 })),
            batchDismissMetadataReview: vi.fn(() => of({ processed: 1, skipped: 0 })),
            getCharacterSuggestions: vi.fn(() => of([])),
            getSeriesSuggestions: vi.fn(() => of([])),
            getThumbnailUrl: vi.fn(() => of('blob:thumb')),
            getPosterUrl: vi.fn(() => of('blob:poster')),
          },
        },
        { provide: BatchesClientService, useValue: { listReviewItems, listAllReviewItems } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: 'b1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.selectedIds.set(['m1']);
    component.removedGroupMediaIds.set({ 'group-1': ['m1'] });
    component.discardedMediaIds.set(['m2']);
    component.expandedGroupIds.set(['group-1']);

    const mergeButton = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Merge all batches & regroup')) ?? null;

    expect(mergeButton).toBeTruthy();

    mergeButton?.click();
    fixture.detectChanges();

    expect(component.scope()).toBe('all_pending');
    expect(component.selectedIds()).toEqual([]);
    expect(component.removedGroupMediaIds()).toEqual({});
    expect(component.discardedMediaIds()).toEqual([]);
    expect(component.expandedGroupIds()).toEqual([]);
    expect(listAllReviewItems).toHaveBeenNthCalledWith(1, { include_recommendations: true });

    allPending$.next(allPendingResponse);
    allPending$.complete();
    fixture.detectChanges();

    expect(component.recommendationGroups().map((group) => group.id)).toEqual(['group-1', 'group-2']);
    expect(fixture.nativeElement.textContent).toContain('4 still need character or series names.');

    const refreshButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[aria-label="Refresh grouping recommendations"]');
    refreshButton.click();
    fixture.detectChanges();

    expect(listAllReviewItems).toHaveBeenNthCalledWith(2, { include_recommendations: true });
    expect(refreshBatchRecommendations).not.toHaveBeenCalled();
    expect(listReviewItems).toHaveBeenCalledTimes(2);
  });

  it('refresh button triggers force-refresh and shows a spinner while refreshing', async () => {
    const refreshBatchRecommendations = vi.fn();
    const recommendations$ = new Subject<ImportBatchReviewListResponse>();
    const listReviewItems = vi.fn()
      .mockReturnValueOnce(of({ total: 0, items: [], recommendation_groups: [] }))
      .mockReturnValueOnce(of({ total: 0, items: [], recommendation_groups: [] }))
      .mockReturnValueOnce(recommendations$);

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: () => null,
            refreshBatchReview: vi.fn(),
            refreshBatchRecommendations,
          },
        },
        {
          provide: MediaService,
          useValue: {
            batchUpdateEntities: vi.fn(() => of({ processed: 1, skipped: 0 })),
            batchDismissMetadataReview: vi.fn(() => of({ processed: 1, skipped: 0 })),
            getCharacterSuggestions: vi.fn(() => of([])),
            getSeriesSuggestions: vi.fn(() => of([])),
            getThumbnailUrl: vi.fn(() => of('blob:thumb')),
            getPosterUrl: vi.fn(() => of('blob:poster')),
          },
        },
        { provide: BatchesClientService, useValue: { listReviewItems } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: 'b1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    // Initial load completes - not refreshing
    expect(fixture.componentInstance.recommendationsRefreshing()).toBe(false);

    const refreshButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[aria-label="Refresh grouping recommendations"]');
    expect(refreshButton).toBeTruthy();
    expect(refreshButton.disabled).toBe(false);

    refreshButton.click();
    fixture.detectChanges();

    // Should be in-progress now
    expect(fixture.componentInstance.recommendationsRefreshing()).toBe(true);
    expect(refreshButton.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeTruthy();
    expect(listReviewItems).toHaveBeenLastCalledWith('b1', { include_recommendations: true, force_refresh: true });

    recommendations$.next({ total: 0, items: [], recommendation_groups: [] });
    recommendations$.complete();
    fixture.detectChanges();

    expect(fixture.componentInstance.recommendationsRefreshing()).toBe(false);
    expect(refreshButton.disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
  });

  it('re-fetches all-pending groups after applying names in all-pending mode', async () => {
    const baseMedia = {
      uploader_id: 'u1',
      uploader_username: 'uploader',
      owner_id: 'u1',
      owner_username: 'owner',
      visibility: MediaVisibility.PRIVATE,
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
      uploaded_at: '2026-03-29T10:00:00Z',
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
    };
    const allItems = ['m1', 'm2', 'm3', 'm4'].map((id, index) => ({
      batch_item_id: `i${index + 1}`,
      source_filename: `${id}.jpg`,
      missing_character: true,
      missing_series: true,
      entities: [],
      media: {
        ...baseMedia,
        id,
        filename: `${id}.jpg`,
        original_filename: `${id}.jpg`,
      },
    }));
    const listAllReviewItems = vi.fn()
      .mockReturnValueOnce(of({
        total: 4,
        items: allItems,
        recommendation_groups: [
          {
            id: 'group-1',
            media_ids: ['m1', 'm2'],
            item_count: 2,
            missing_character_count: 2,
            missing_series_count: 2,
            suggested_characters: [{ name: 'ryuuguu_rena', confidence: 0.9 }],
            suggested_series: [],
            shared_signals: [{ kind: 'tag', label: 'higurashi_no_naku_koro_ni', confidence: 0.8 }],
            confidence: 0.91,
          },
          {
            id: 'group-2',
            media_ids: ['m3', 'm4'],
            item_count: 2,
            missing_character_count: 2,
            missing_series_count: 2,
            suggested_characters: [{ name: 'artoria_pendragon_(fate)', confidence: 0.88 }],
            suggested_series: [],
            shared_signals: [{ kind: 'tag', label: 'fate_stay_night', confidence: 0.8 }],
            confidence: 0.86,
          },
        ],
      }))
      .mockReturnValueOnce(of({
        total: 2,
        items: allItems.slice(2),
        recommendation_groups: [
          {
            id: 'group-2',
            media_ids: ['m3', 'm4'],
            item_count: 2,
            missing_character_count: 2,
            missing_series_count: 2,
            suggested_characters: [{ name: 'artoria_pendragon_(fate)', confidence: 0.88 }],
            suggested_series: [],
            shared_signals: [{ kind: 'tag', label: 'fate_stay_night', confidence: 0.8 }],
            confidence: 0.86,
          },
        ],
      }));
    const batchUpdateEntities = vi.fn(() => of({ processed: 2, skipped: 0 }));

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: () => null,
            refreshBatchReview: vi.fn(),
            refreshBatchRecommendations: vi.fn(),
          },
        },
        {
          provide: MediaService,
          useValue: {
            batchUpdateEntities,
            batchDismissMetadataReview: vi.fn(() => of({ processed: 1, skipped: 0 })),
            getCharacterSuggestions: vi.fn(() => of([])),
            getSeriesSuggestions: vi.fn(() => of([])),
            getThumbnailUrl: vi.fn(() => of('blob:thumb')),
            getPosterUrl: vi.fn(() => of('blob:poster')),
          },
        },
        { provide: BatchesClientService, useValue: { listReviewItems: vi.fn(), listAllReviewItems } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: null } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.recommendationGroups().map((group) => group.id)).toEqual(['group-1', 'group-2']);

    component.toggleGroupSelection(component.recommendationGroups()[0]);
    component.addCharacter('Ryuuguu Rena');
    component.applySelected();
    fixture.detectChanges();

    expect(batchUpdateEntities).toHaveBeenCalledWith({
      media_ids: ['m1', 'm2'],
      character_names: ['ryuuguu_rena'],
      series_names: undefined,
    });
    expect(listAllReviewItems).toHaveBeenNthCalledWith(2, { include_recommendations: true });
    expect(component.recommendationGroups().map((group) => group.id)).toEqual(['group-2']);
  });

  it('re-fetches all-pending groups after discarding in all-pending mode', async () => {
    const baseMedia = {
      uploader_id: 'u1',
      uploader_username: 'uploader',
      owner_id: 'u1',
      owner_username: 'owner',
      visibility: MediaVisibility.PRIVATE,
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
      uploaded_at: '2026-03-29T10:00:00Z',
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
    };
    const allItems = ['m1', 'm2', 'm3', 'm4'].map((id, index) => ({
      batch_item_id: `i${index + 1}`,
      source_filename: `${id}.jpg`,
      missing_character: true,
      missing_series: true,
      entities: [],
      media: {
        ...baseMedia,
        id,
        filename: `${id}.jpg`,
        original_filename: `${id}.jpg`,
      },
    }));
    const listAllReviewItems = vi.fn()
      .mockReturnValueOnce(of({
        total: 4,
        items: allItems,
        recommendation_groups: [
          {
            id: 'group-1',
            media_ids: ['m1', 'm2'],
            item_count: 2,
            missing_character_count: 2,
            missing_series_count: 2,
            suggested_characters: [{ name: 'ryuuguu_rena', confidence: 0.9 }],
            suggested_series: [],
            shared_signals: [{ kind: 'tag', label: 'higurashi_no_naku_koro_ni', confidence: 0.8 }],
            confidence: 0.91,
          },
          {
            id: 'group-2',
            media_ids: ['m3', 'm4'],
            item_count: 2,
            missing_character_count: 2,
            missing_series_count: 2,
            suggested_characters: [{ name: 'artoria_pendragon_(fate)', confidence: 0.88 }],
            suggested_series: [],
            shared_signals: [{ kind: 'tag', label: 'fate_stay_night', confidence: 0.8 }],
            confidence: 0.86,
          },
        ],
      }))
      .mockReturnValueOnce(of({
        total: 2,
        items: allItems.slice(2),
        recommendation_groups: [
          {
            id: 'group-2',
            media_ids: ['m3', 'm4'],
            item_count: 2,
            missing_character_count: 2,
            missing_series_count: 2,
            suggested_characters: [{ name: 'artoria_pendragon_(fate)', confidence: 0.88 }],
            suggested_series: [],
            shared_signals: [{ kind: 'tag', label: 'fate_stay_night', confidence: 0.8 }],
            confidence: 0.86,
          },
        ],
      }));
    const batchDismissMetadataReview = vi.fn(() => of({ processed: 2, skipped: 0 }));

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: () => null,
            refreshBatchReview: vi.fn(),
            refreshBatchRecommendations: vi.fn(),
          },
        },
        {
          provide: MediaService,
          useValue: {
            batchUpdateEntities: vi.fn(() => of({ processed: 1, skipped: 0 })),
            batchDismissMetadataReview,
            getCharacterSuggestions: vi.fn(() => of([])),
            getSeriesSuggestions: vi.fn(() => of([])),
            getThumbnailUrl: vi.fn(() => of('blob:thumb')),
            getPosterUrl: vi.fn(() => of('blob:poster')),
          },
        },
        { provide: BatchesClientService, useValue: { listReviewItems: vi.fn(), listAllReviewItems } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: null } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.discardGroup(component.recommendationGroups()[0]);
    fixture.detectChanges();

    expect(batchDismissMetadataReview).toHaveBeenCalledWith(['m1', 'm2'], true);
    expect(listAllReviewItems).toHaveBeenNthCalledWith(2, { include_recommendations: true });
    expect(component.recommendationGroups().map((group) => group.id)).toEqual(['group-2']);
  });

  it('keeps untouched recommendation groups after applying names in remote mode', async () => {
    const baseMedia = {
      uploader_id: 'u1',
      uploader_username: 'uploader',
      owner_id: 'u1',
      owner_username: 'owner',
      visibility: MediaVisibility.PRIVATE,
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
      uploaded_at: '2026-03-29T10:00:00Z',
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
    };
    const allItems = ['m1', 'm2', 'm3', 'm4'].map((id, index) => ({
      batch_item_id: `i${index + 1}`,
      source_filename: `${id}.jpg`,
      missing_character: true,
      missing_series: true,
      entities: [],
      media: {
        ...baseMedia,
        id,
        filename: `${id}.jpg`,
        original_filename: `${id}.jpg`,
      },
    }));
    const listReviewItems = vi.fn()
      .mockReturnValueOnce(of({ total: 4, items: allItems, recommendation_groups: [] }))
      .mockReturnValueOnce(of({
        total: 4,
        items: allItems,
        recommendation_groups: [
          {
            id: 'group-1',
            media_ids: ['m1', 'm2'],
            item_count: 2,
            missing_character_count: 2,
            missing_series_count: 2,
            suggested_characters: [{ name: 'ryuuguu_rena', confidence: 0.9 }],
            suggested_series: [],
            shared_signals: [{ kind: 'tag', label: 'higurashi_no_naku_koro_ni', confidence: 0.8 }],
            confidence: 0.91,
          },
          {
            id: 'group-2',
            media_ids: ['m3', 'm4'],
            item_count: 2,
            missing_character_count: 2,
            missing_series_count: 2,
            suggested_characters: [{ name: 'artoria_pendragon_(fate)', confidence: 0.88 }],
            suggested_series: [],
            shared_signals: [{ kind: 'tag', label: 'fate_stay_night', confidence: 0.8 }],
            confidence: 0.86,
          },
        ],
      }))
      .mockReturnValueOnce(of({
        total: 2,
        items: allItems.slice(2),
        recommendation_groups: [],
      }));
    const batchUpdateEntities = vi.fn(() => of({ processed: 2, skipped: 0 }));

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: () => null,
            refreshBatchReview: vi.fn(),
            refreshBatchRecommendations: vi.fn(),
          },
        },
        {
          provide: MediaService,
          useValue: {
            batchUpdateEntities,
            batchDismissMetadataReview: vi.fn(() => of({ processed: 1, skipped: 0 })),
            getCharacterSuggestions: vi.fn(() => of([])),
            getSeriesSuggestions: vi.fn(() => of([])),
            getThumbnailUrl: vi.fn(() => of('blob:thumb')),
            getPosterUrl: vi.fn(() => of('blob:poster')),
          },
        },
        { provide: BatchesClientService, useValue: { listReviewItems } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: 'b1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.recommendationGroups().map((group) => group.id)).toEqual(['group-1', 'group-2']);

    component.toggleGroupSelection(component.recommendationGroups()[0]);
    component.addCharacter('Ryuuguu Rena');
    component.applySelected();
    fixture.detectChanges();

    expect(batchUpdateEntities).toHaveBeenCalledWith({
      media_ids: ['m1', 'm2'],
      character_names: ['ryuuguu_rena'],
      series_names: undefined,
    });
    expect(listReviewItems).toHaveBeenNthCalledWith(3, 'b1');
    expect(component.recommendationGroups().map((group) => group.id)).toEqual(['group-2']);
  });

  it('caps visible group previews and shows an overflow indicator for larger groups', async () => {
    const reviewItems = Array.from({ length: 6 }, (_, index) => ({
      batch_item_id: `i${index + 1}`,
      source_filename: `missing-${index + 1}.jpg`,
      missing_character: true,
      missing_series: true,
      entities: [],
      media: {
        id: `m${index + 1}`,
        uploader_id: 'u1',
        uploader_username: 'uploader',
        owner_id: 'u1',
        owner_username: 'owner',
        visibility: MediaVisibility.PRIVATE,
        filename: `missing-${index + 1}.jpg`,
        original_filename: `missing-${index + 1}.jpg`,
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
        uploaded_at: '2026-03-29T10:00:00Z',
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
    }));

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: UploadTrackerService,
          useValue: {
            getBatchReview: () => ({
              id: 'b1',
              recommendationGroups: [{
                id: 'group-1',
                media_ids: reviewItems.map((item) => item.media.id),
                item_count: 6,
                missing_character_count: 6,
                missing_series_count: 6,
                suggested_characters: [{ name: 'Saber', confidence: 1 }],
                suggested_series: [{ name: 'Fate/stay night', confidence: 1 }],
                shared_signals: [],
                confidence: 0.9,
              }],
              reviewItems,
              reviewBaselineTotal: 6,
              reviewRefreshing: false,
              recommendationsRefreshing: false,
            }),
            refreshBatchReview: vi.fn(),
            refreshBatchRecommendations: vi.fn(),
          },
        },
        {
          provide: MediaService,
          useValue: {
            batchUpdateEntities: vi.fn(() => of({ processed: 1, skipped: 0 })),
            batchDismissMetadataReview: vi.fn(() => of({ processed: 1, skipped: 0 })),
            getCharacterSuggestions: vi.fn(() => of([])),
            getSeriesSuggestions: vi.fn(() => of([])),
            getThumbnailUrl: vi.fn(() => of('blob:thumb')),
            getPosterUrl: vi.fn(() => of('blob:poster')),
          },
        },
        { provide: BatchesClientService, useValue: { listReviewItems: vi.fn(() => of({ total: 0, items: [], recommendation_groups: [] })) } },
        { provide: MAT_DIALOG_DATA, useValue: { batchId: 'b1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.previewItemsForGroup(component.recommendationGroups()[0])).toHaveLength(4);
    expect(component.displayedPreviewItemsForGroup(component.recommendationGroups()[0])).toHaveLength(4);
    expect(component.hiddenPreviewCount(component.recommendationGroups()[0])).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('+2');
    expect(fixture.nativeElement.textContent).toContain('6 related items');

    component.toggleGroupExpanded(component.recommendationGroups()[0]);
    fixture.detectChanges();

    expect(component.displayedPreviewItemsForGroup(component.recommendationGroups()[0])).toHaveLength(6);
    expect(component.hiddenPreviewCount(component.recommendationGroups()[0])).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Collapse items');
  });
});
