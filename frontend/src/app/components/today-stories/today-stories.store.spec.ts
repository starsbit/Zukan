import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../models/media';
import { GalleryStore } from '../../services/gallery.store';
import { MediaClientService } from '../../services/web/media-client.service';
import { TodayStoriesStore } from './today-stories.store';

describe('TodayStoriesStore', () => {
  it('loads and sorts stories newest first', async () => {
    const client = {
      search: vi.fn(() => of({
        items: [buildMedia('older', '2022-04-02T09:00:00Z'), buildMedia('newer', '2025-04-02T09:00:00Z')],
        total: 2,
        next_cursor: null,
        has_more: false,
        page_size: 100,
      })),
      batchUpdate: vi.fn(),
    };
    const galleryStore = { patchItem: vi.fn(), removeItem: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        TodayStoriesStore,
        { provide: MediaClientService, useValue: client },
        { provide: GalleryStore, useValue: galleryStore },
      ],
    });

    const store = TestBed.inject(TodayStoriesStore);
    store.setParams({ captured_month: 4, captured_day: 2, captured_before_year: 2026 });
    await Promise.resolve();

    expect(store.items().map((item) => item.id)).toEqual(['newer', 'older']);
  });

  it('removes unfavorited items from favorited story scope and syncs the page store', () => {
    const client = {
      search: vi.fn(() => of({
        items: [buildMedia('fav', '2025-04-02T09:00:00Z', true)],
        total: 1,
        next_cursor: null,
        has_more: false,
        page_size: 100,
      })),
      batchUpdate: vi.fn(() => of({ processed: 1, skipped: 0 })),
    };
    const galleryStore = { patchItem: vi.fn(), removeItem: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        TodayStoriesStore,
        { provide: MediaClientService, useValue: client },
        { provide: GalleryStore, useValue: galleryStore },
      ],
    });

    const store = TestBed.inject(TodayStoriesStore);
    store.setParams({ favorited: true, captured_month: 4, captured_day: 2, captured_before_year: 2026 });
    const item = store.items()[0]!;

    store.toggleFavorite(item).subscribe();

    expect(store.items()).toEqual([]);
    expect(galleryStore.removeItem).toHaveBeenCalledWith('fav');
  });

  it('reverts optimistic favorite updates on failure', () => {
    const client = {
      search: vi.fn(() => of({
        items: [buildMedia('fav', '2025-04-02T09:00:00Z')],
        total: 1,
        next_cursor: null,
        has_more: false,
        page_size: 100,
      })),
      batchUpdate: vi.fn(() => throwError(() => new Error('nope'))),
    };
    const galleryStore = { patchItem: vi.fn(), removeItem: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        TodayStoriesStore,
        { provide: MediaClientService, useValue: client },
        { provide: GalleryStore, useValue: galleryStore },
      ],
    });

    const store = TestBed.inject(TodayStoriesStore);
    store.setParams({ captured_month: 4, captured_day: 2, captured_before_year: 2026 });
    const original = store.items()[0]!;

    store.toggleFavorite(original).subscribe({ error: () => {} });

    expect(store.items()[0]?.is_favorited).toBe(false);
    expect(galleryStore.patchItem).toHaveBeenLastCalledWith(original);
  });
});

function buildMedia(id: string, capturedAt: string, isFavorited = false) {
  return {
    id,
    uploader_id: null,
    owner_id: null,
    visibility: MediaVisibility.PRIVATE,
    filename: `${id}.jpg`,
    original_filename: `${id}.jpg`,
    media_type: MediaType.IMAGE,
    metadata: {
      file_size: 10,
      width: 100,
      height: 100,
      duration_seconds: null,
      frame_count: null,
      mime_type: 'image/jpeg',
      captured_at: capturedAt,
    },
    version: 1,
    uploaded_at: capturedAt,
    deleted_at: null,
    tags: [],
    ocr_text_override: null,
    is_nsfw: false,
    tagging_status: TaggingStatus.DONE,
    tagging_error: null,
    thumbnail_status: ProcessingStatus.DONE,
    poster_status: ProcessingStatus.NOT_APPLICABLE,
    ocr_text: null,
    is_favorited: isFavorited,
    favorite_count: isFavorited ? 1 : 0,
  };
}
