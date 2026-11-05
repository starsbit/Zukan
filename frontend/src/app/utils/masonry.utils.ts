import { MediaRead } from '../models/media';

export interface MasonryPlacement<T> {
  item: T;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MasonryLayout<T> {
  placements: MasonryPlacement<T>[];
  totalHeight: number;
}

export function computeMasonry<T extends Pick<MediaRead, 'metadata'>>(
  items: readonly T[],
  width: number,
  columns: number,
  gap: number,
): MasonryLayout<T> {
  const columnCount = Math.max(1, Math.floor(columns));
  const columnWidth = (width - gap * (columnCount - 1)) / columnCount;
  if (columnWidth <= 0) {
    return { placements: [], totalHeight: 0 };
  }

  const columnHeights = new Array<number>(columnCount).fill(0);
  const placements = items.map((item) => {
    const column = columnHeights.indexOf(Math.min(...columnHeights));
    const top = columnHeights[column] ?? 0;
    const height = columnWidth * heightRatio(item);
    columnHeights[column] = top + height + gap;
    return { item, left: column * (columnWidth + gap), top, width: columnWidth, height };
  });

  return {
    placements,
    totalHeight: items.length === 0 ? 0 : Math.max(...columnHeights) - gap,
  };
}

function heightRatio(item: Pick<MediaRead, 'metadata'>): number {
  const { width, height } = item.metadata;
  return width && height ? height / width : 1;
}
