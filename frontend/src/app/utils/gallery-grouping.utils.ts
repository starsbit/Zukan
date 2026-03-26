import { MediaRead } from '../models/api';

export interface GalleryDayGroup {
  key: string;
  label: string;
  items: MediaRead[];
}

export function shouldAnimateGalleryRegroup(previousItems: MediaRead[], nextItems: MediaRead[], hasRenderedItems: boolean): boolean {
  if (!hasRenderedItems || previousItems.length === 0 || nextItems.length === 0) {
    return false;
  }

  if (previousItems.length !== nextItems.length) {
    return true;
  }

  for (let index = 0; index < previousItems.length; index += 1) {
    const previous = previousItems[index];
    const next = nextItems[index];
    if (!previous || !next) {
      return true;
    }

    if (previous.id !== next.id || previous.metadata.captured_at !== next.metadata.captured_at) {
      return true;
    }
  }

  return false;
}

export function buildGalleryDayGroups(items: MediaRead[]): GalleryDayGroup[] {
  const groups = new Map<string, GalleryDayGroup>();

  for (const item of items) {
    const key = getLocalDayKey(item.metadata.captured_at);
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(key, {
      key,
      label: formatGroupLabel(item.metadata.captured_at),
      items: [item]
    });
  }

  return Array.from(groups.values());
}

function getLocalDayKey(value: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  const day = parts.find((part) => part.type === 'day')?.value ?? '00';

  return `${year}-${month}-${day}`;
}

function formatGroupLabel(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  };

  if (date.getFullYear() !== now.getFullYear()) {
    options.year = 'numeric';
  }

  return new Intl.DateTimeFormat(undefined, options).format(date);
}
