import { MediaListState, MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../models/media';
import { describe, expect, it } from 'vitest';
import {
  buildTodayStoriesParams,
  groupTodayStoryItems,
  sortTodayStoryItems,
  toTodayStoryItem,
} from './today-stories.utils';

describe('today-stories utils', () => {
  it('builds today-years-ago params while preserving page scope filters', () => {
    expect(buildTodayStoriesParams({
      state: MediaListState.ACTIVE,
      visibility: MediaVisibility.PUBLIC,
      favorited: true,
      media_type: [MediaType.VIDEO],
      tag: ['archived'],
      after: 'cursor-1',
      page_size: 200,
      include_total: true,
      captured_year: 2024,
      captured_after: '2024-04-02T00:00:00Z',
      captured_before: '2024-04-02T23:59:59Z',
      sort_by: 'uploaded_at',
      sort_order: 'asc',
    }, new Date('2026-04-02T12:00:00'))).toEqual({
      state: MediaListState.ACTIVE,
      visibility: MediaVisibility.PUBLIC,
      favorited: true,
      media_type: [MediaType.VIDEO],
      tag: ['archived'],
      captured_month: 4,
      captured_day: 2,
      captured_before_year: 2026,
      sort_by: 'captured_at',
      sort_order: 'desc',
    });
  });

  it('enriches and sorts stories from newest to oldest', () => {
    const items = sortTodayStoryItems([
      toTodayStoryItem(buildMedia('older', '2021-04-02T09:00:00Z'), new Date('2026-04-02T12:00:00Z')),
      toTodayStoryItem(buildMedia('newer', '2024-04-02T09:00:00Z'), new Date('2026-04-02T12:00:00Z')),
    ]);

    expect(items.map((item) => item.id)).toEqual(['newer', 'older']);
    expect(items[0]?.yearsAgoLabel).toBe('2 years ago');
    expect(items[1]?.capturedDateLabel).toBe('April 2');
  });

  it('groups multiple stories under one years-ago card', () => {
    const groups = groupTodayStoryItems([
      toTodayStoryItem(buildMedia('a', '2024-04-02T09:00:00Z'), new Date('2026-04-02T12:00:00Z')),
      toTodayStoryItem(buildMedia('b', '2024-04-02T07:00:00Z'), new Date('2026-04-02T12:00:00Z')),
      toTodayStoryItem(buildMedia('c', '2023-04-02T10:00:00Z'), new Date('2026-04-02T12:00:00Z')),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.yearsAgoLabel).toBe('2 years ago');
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups[1]?.yearsAgoLabel).toBe('3 years ago');
  });
});

function buildMedia(id: string, capturedAt: string) {
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
    is_favorited: false,
    favorite_count: 0,
  };
}
