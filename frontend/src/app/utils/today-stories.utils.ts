import { MediaSearchParams } from '../services/web/media-client.service';
import { TodayStoryGroup, TodayStoryItem } from '../models/today-stories';
import { MediaRead } from '../models/media';

export const IMAGE_STORY_DURATION_MS = 5000;
export const VIDEO_FALLBACK_STORY_DURATION_MS = 15000;

const CAPTURED_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
});

export function buildTodayStoriesParams(
  sharedParams: MediaSearchParams,
  now = new Date(),
): MediaSearchParams {
  const {
    after: _after,
    page_size: _pageSize,
    include_total: _includeTotal,
    captured_year: _capturedYear,
    captured_after: _capturedAfter,
    captured_before: _capturedBefore,
    ...remaining
  } = sharedParams;

  return {
    ...remaining,
    captured_month: now.getMonth() + 1,
    captured_day: now.getDate(),
    captured_before_year: now.getFullYear(),
    sort_by: 'captured_at',
    sort_order: 'desc',
  };
}

export function toTodayStoryItem(media: MediaRead, now = new Date()): TodayStoryItem {
  const capturedAt = new Date(media.metadata.captured_at || media.created_at);
  const capturedYear = Number.isFinite(capturedAt.getFullYear()) ? capturedAt.getFullYear() : now.getFullYear();
  const yearsAgo = Math.max(0, now.getFullYear() - capturedYear);

  return {
    ...media,
    yearsAgo,
    yearsAgoLabel: yearsAgo === 1 ? '1 year ago' : `${yearsAgo} years ago`,
    capturedDateLabel: CAPTURED_DATE_FORMAT.format(capturedAt),
  };
}

export function sortTodayStoryItems(items: TodayStoryItem[]): TodayStoryItem[] {
  return items.slice().sort((left, right) => {
    const leftDate = left.metadata.captured_at || left.created_at;
    const rightDate = right.metadata.captured_at || right.created_at;
    return rightDate.localeCompare(leftDate);
  });
}

export function groupTodayStoryItems(items: TodayStoryItem[]): TodayStoryGroup[] {
  const groups = new Map<number, TodayStoryItem[]>();

  for (const item of sortTodayStoryItems(items)) {
    const yearGroup = groups.get(item.yearsAgo);
    if (yearGroup) {
      yearGroup.push(item);
    } else {
      groups.set(item.yearsAgo, [item]);
    }
  }

  return Array.from(groups.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, groupItems]) => ({
      yearsAgo: groupItems[0]!.yearsAgo,
      yearsAgoLabel: groupItems[0]!.yearsAgoLabel,
      capturedDateLabel: groupItems[0]!.capturedDateLabel,
      coverItem: groupItems[0]!,
      items: groupItems,
    }));
}
