import { describe, it, expect } from 'vitest';
import { groupByDay, groupTimelineByYear } from './gallery-grouping.utils';
import { MediaType, TaggingStatus, ProcessingStatus, MediaVisibility } from '../models/media';
import { TimelineBucket } from '../models/timeline';

function makeMedia(id: string, captured_at: string) {
  return {
    id,
    uploader_id: 'u1',
    owner_id: 'u1',
    visibility: MediaVisibility.PRIVATE,
    filename: `${id}.jpg`,
    original_filename: null,
    media_type: MediaType.IMAGE,
    metadata: {
      file_size: 100, width: 10, height: 10,
      duration_seconds: null, frame_count: null,
      mime_type: 'image/jpeg', captured_at,
    },
    version: 1,
    uploaded_at: captured_at,
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

describe('groupByDay()', () => {
  it('returns empty array for empty input', () => {
    expect(groupByDay([])).toEqual([]);
  });

  it('puts a single item in one group', () => {
    const result = groupByDay([makeMedia('m1', '2026-03-28T12:00:00Z')]);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-03-28');
    expect(result[0].items).toHaveLength(1);
    expect(result[0].label).toMatch(/March/);
    expect(result[0].label).toMatch(/28/);
    expect(result[0].label).toMatch(/2026/);
  });

  it('groups two items on the same day into one group', () => {
    const items = [
      makeMedia('m1', '2026-03-28T08:00:00Z'),
      makeMedia('m2', '2026-03-28T20:00:00Z'),
    ];
    const result = groupByDay(items);
    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(2);
  });

  it('creates separate groups for different days', () => {
    const items = [
      makeMedia('m1', '2026-03-28T08:00:00Z'),
      makeMedia('m2', '2026-03-27T08:00:00Z'),
      makeMedia('m3', '2026-01-01T00:00:00Z'),
    ];
    const result = groupByDay(items);
    expect(result).toHaveLength(3);
    expect(result[0].date).toBe('2026-03-28');
    expect(result[1].date).toBe('2026-03-27');
    expect(result[2].date).toBe('2026-01-01');
  });

  it('preserves item order within a group', () => {
    const items = [
      makeMedia('m1', '2026-03-28T12:00:00Z'),
      makeMedia('m2', '2026-03-28T08:00:00Z'),
    ];
    const result = groupByDay(items);
    expect(result[0].items[0].id).toBe('m1');
    expect(result[0].items[1].id).toBe('m2');
  });

  it('preserves input ordering for group order', () => {
    const items = [
      makeMedia('m1', '2025-12-31T00:00:00Z'),
      makeMedia('m2', '2024-01-01T00:00:00Z'),
    ];
    const result = groupByDay(items);
    expect(result[0].date).toBe('2025-12-31');
    expect(result[1].date).toBe('2024-01-01');
  });

  it('handles midnight boundary correctly (UTC)', () => {
    const items = [
      makeMedia('m1', '2026-03-28T00:00:00Z'),
      makeMedia('m2', '2026-03-27T23:59:59Z'),
    ];
    const result = groupByDay(items);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2026-03-28');
    expect(result[1].date).toBe('2026-03-27');
  });
});

describe('groupTimelineByYear()', () => {
  it('returns empty array for empty input', () => {
    expect(groupTimelineByYear([])).toEqual([]);
  });

  it('creates one year group for a single bucket', () => {
    const buckets: TimelineBucket[] = [{ year: 2026, month: 3, count: 10 }];
    const result = groupTimelineByYear(buckets);
    expect(result).toHaveLength(1);
    expect(result[0].year).toBe(2026);
    expect(result[0].count).toBe(10);
    expect(result[0].months).toHaveLength(1);
    expect(result[0].months[0].month).toBe(3);
  });

  it('sums counts for multiple months in the same year', () => {
    const buckets: TimelineBucket[] = [
      { year: 2026, month: 3, count: 10 },
      { year: 2026, month: 2, count: 5 },
      { year: 2026, month: 1, count: 20 },
    ];
    const result = groupTimelineByYear(buckets);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(35);
    expect(result[0].months).toHaveLength(3);
  });

  it('creates separate groups for different years', () => {
    const buckets: TimelineBucket[] = [
      { year: 2026, month: 3, count: 10 },
      { year: 2025, month: 12, count: 8 },
      { year: 2024, month: 6, count: 3 },
    ];
    const result = groupTimelineByYear(buckets);
    expect(result).toHaveLength(3);
    expect(result[0].year).toBe(2026);
    expect(result[1].year).toBe(2025);
    expect(result[2].year).toBe(2024);
  });

  it('preserves months in input order within each year group', () => {
    const buckets: TimelineBucket[] = [
      { year: 2026, month: 3, count: 5 },
      { year: 2026, month: 2, count: 3 },
    ];
    const result = groupTimelineByYear(buckets);
    expect(result[0].months[0].month).toBe(3);
    expect(result[0].months[1].month).toBe(2);
  });

  it('handles mixed years correctly', () => {
    const buckets: TimelineBucket[] = [
      { year: 2026, month: 1, count: 2 },
      { year: 2025, month: 12, count: 7 },
      { year: 2026, month: 2, count: 3 },
    ];
    const result = groupTimelineByYear(buckets);
    // 2026 appears first in input, 2025 second
    expect(result[0].year).toBe(2026);
    expect(result[0].count).toBe(5);
    expect(result[0].months).toHaveLength(2);
    expect(result[1].year).toBe(2025);
    expect(result[1].count).toBe(7);
  });
});
