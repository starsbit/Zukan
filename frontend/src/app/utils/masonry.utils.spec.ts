import { describe, expect, it } from 'vitest';
import { computeMasonry } from './masonry.utils';

function item(width: number | null, height: number | null) {
  return { metadata: { width, height } } as never;
}

describe('computeMasonry', () => {
  it('places each item in the shortest column', () => {
    const { placements, totalHeight } = computeMasonry(
      [item(100, 200), item(100, 100), item(100, 100)],
      210,
      2,
      10,
    );

    expect(placements.map(({ left, top, width, height }) => ({ left, top, width, height }))).toEqual([
      { left: 0, top: 0, width: 100, height: 200 },
      { left: 110, top: 0, width: 100, height: 100 },
      { left: 110, top: 110, width: 100, height: 100 },
    ]);
    expect(totalHeight).toBe(210);
  });

  it('falls back to a square when dimensions are missing', () => {
    const { placements } = computeMasonry([item(null, null), item(0, 50)], 100, 1, 0);

    expect(placements.map((placement) => placement.height)).toEqual([100, 100]);
  });

  it('gives the same layout for the same input', () => {
    const items = [item(120, 80), item(90, 160), item(300, 200), item(100, 100)];

    expect(computeMasonry(items, 800, 3, 12)).toEqual(computeMasonry(items, 800, 3, 12));
  });

  it('returns nothing without items or usable width', () => {
    expect(computeMasonry([], 800, 3, 12)).toEqual({ placements: [], totalHeight: 0 });
    expect(computeMasonry([item(1, 1)], 0, 3, 12)).toEqual({ placements: [], totalHeight: 0 });
  });
});
