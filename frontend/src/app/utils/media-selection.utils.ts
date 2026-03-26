import { MediaRead } from '../models/api';
import { GalleryDayGroup } from './gallery-grouping.utils';

export function toggleMediaSelection(selected: Set<string>, media: MediaRead): Set<string> {
  const next = new Set(selected);

  if (next.has(media.id)) {
    next.delete(media.id);
  } else {
    next.add(media.id);
  }

  return next;
}

export function clearMediaSelection(): Set<string> {
  return new Set<string>();
}

export function selectMediaGroup(selected: Set<string>, group: GalleryDayGroup): Set<string> {
  if (group.items.length === 0) {
    return selected;
  }

  const next = new Set(selected);
  for (const item of group.items) {
    next.add(item.id);
  }

  return next;
}

export function isMediaSelected(selected: Set<string>, mediaId: string): boolean {
  return selected.has(mediaId);
}

export function isMediaGroupSelected(selected: Set<string>, group: GalleryDayGroup): boolean {
  return group.items.length > 0 && group.items.every((item) => selected.has(item.id));
}
