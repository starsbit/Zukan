import { describe, expect, it } from 'vitest';

import { formatDisplayValue } from './display-value.utils';

describe('display value utils', () => {
  it('formats snake case and lower case values for display', () => {
    expect(formatDisplayValue('ikari_shinji')).toBe('Ikari Shinji');
    expect(formatDisplayValue('blue eyes')).toBe('Blue Eyes');
    expect(formatDisplayValue('processing')).toBe('Processing');
  });

  it('preserves mixed case words while normalizing separators', () => {
    expect(formatDisplayValue('Sumika (MuvLuv)')).toBe('Sumika (MuvLuv)');
    expect(formatDisplayValue('tag-category_name')).toBe('Tag Category Name');
  });

  it('returns an empty string for blank values', () => {
    expect(formatDisplayValue('   ')).toBe('');
    expect(formatDisplayValue(null)).toBe('');
  });
});
