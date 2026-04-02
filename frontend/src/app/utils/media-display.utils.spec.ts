import { describe, expect, it } from 'vitest';
import { MediaType, MediaVisibility, ProcessingStatus } from '../models/media';
import {
  formatConfidence,
  formatDateTime,
  formatDimensions,
  formatDuration,
  formatFileSize,
  formatMetadataName,
  formatMediaType,
  formatProcessingStatus,
  formatVisibility,
  humanizeBackendLabel,
} from './media-display.utils';

describe('media-display utils', () => {
  it('formats file sizes into readable units', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats durations into readable labels', () => {
    expect(formatDuration(12.4)).toBe('12.4 sec');
    expect(formatDuration(65)).toBe('1 min 5 sec');
    expect(formatDuration(3661)).toBe('1 hr 1 min 1 sec');
  });

  it('formats backend labels and enums for display', () => {
    expect(humanizeBackendLabel('tagging_failed')).toBe('Tagging Failed');
    expect(humanizeBackendLabel('fate/stay night')).toBe('Fate/Stay Night');
    expect(formatMetadataName('aru_(blue_archive)')).toBe('Aru (Blue Archive)');
    expect(formatMetadataName('fate_stay_night')).toBe('Fate Stay Night');
    expect(formatMediaType(MediaType.GIF)).toBe('GIF');
    expect(formatVisibility(MediaVisibility.PUBLIC)).toBe('Public');
    expect(formatProcessingStatus(ProcessingStatus.NOT_APPLICABLE)).toBe('Not Applicable');
  });

  it('formats dimensions, timestamps, and confidence values', () => {
    expect(formatDimensions(1920, 1080)).toBe('1920 x 1080');
    expect(formatDateTime('2026-03-24T15:07:11Z')).toContain('Mar');
    expect(formatConfidence(0.93)).toBe('93%');
  });

  it('returns empty strings for missing values', () => {
    expect(formatFileSize(null)).toBe('');
    expect(formatDuration(null)).toBe('');
    expect(formatDateTime('')).toBe('');
    expect(formatConfidence(undefined)).toBe('');
  });
});
