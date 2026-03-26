import { describe, expect, it } from 'vitest';

import { createMediaRead } from '../testing/media-test.utils';
import { buildGalleryDayGroups, shouldAnimateGalleryRegroup } from './gallery-grouping.utils';

describe('gallery-grouping.utils', () => {
  it('builds groups by local day key while preserving item order', () => {
    const dayOneA = createMediaRead({ id: 'media-1', metadata: { ...createMediaRead().metadata, captured_at: '2026-03-21T08:00:00Z' } });
    const dayOneB = createMediaRead({ id: 'media-2', metadata: { ...createMediaRead().metadata, captured_at: '2026-03-21T15:00:00Z' } });
    const dayTwo = createMediaRead({ id: 'media-3', metadata: { ...createMediaRead().metadata, captured_at: '2026-03-20T09:00:00Z' } });

    const groups = buildGalleryDayGroups([dayOneA, dayOneB, dayTwo]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['media-1', 'media-2']);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(['media-3']);
  });

  it('flags regroup animation when item order changes after initial render', () => {
    const before = [
      createMediaRead({ id: 'media-1', metadata: { ...createMediaRead().metadata, captured_at: '2026-03-21T08:00:00Z' } }),
      createMediaRead({ id: 'media-2', metadata: { ...createMediaRead().metadata, captured_at: '2026-03-20T08:00:00Z' } })
    ];
    const after = [before[1]!, before[0]!];

    expect(shouldAnimateGalleryRegroup(before, after, true)).toBe(true);
  });

  it('skips regroup animation before first render', () => {
    const before = [createMediaRead({ id: 'media-1' })];
    const after = [createMediaRead({ id: 'media-1' })];

    expect(shouldAnimateGalleryRegroup(before, after, false)).toBe(false);
  });
});
