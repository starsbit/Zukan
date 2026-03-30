import { MediaRead } from '../models/media';
import { TimelineBucket, TimelineYearGroup } from '../models/timeline';

export interface DayGroup {
  /** ISO date string: "2026-03-28" */
  date: string;
  /** Human-readable label, e.g. "March 28, 2026" */
  label: string;
  items: MediaRead[];
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * Groups a flat list of MediaRead items by their captured_at date (UTC day).
 * Assumes the list is already sorted newest-first; groups preserve that order.
 */
export function groupByDay(items: MediaRead[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  const order: string[] = [];

  for (const item of items) {
    const date = item.metadata.captured_at.slice(0, 10); // "YYYY-MM-DD"
    if (!map.has(date)) {
      const d = new Date(`${date}T00:00:00Z`);
      map.set(date, { date, label: DATE_FORMAT.format(d), items: [] });
      order.push(date);
    }
    map.get(date)!.items.push(item);
  }

  return order.map(date => map.get(date)!);
}

/**
 * Folds a flat list of TimelineBuckets into year groups.
 * Buckets are expected to already be sorted newest-first.
 */
export function groupTimelineByYear(buckets: TimelineBucket[]): TimelineYearGroup[] {
  const map = new Map<number, TimelineYearGroup>();
  const order: number[] = [];

  for (const bucket of buckets) {
    if (!map.has(bucket.year)) {
      map.set(bucket.year, { year: bucket.year, count: 0, months: [] });
      order.push(bucket.year);
    }
    const group = map.get(bucket.year)!;
    group.count += bucket.count;
    group.months.push(bucket);
  }

  return order.map(year => map.get(year)!);
}
