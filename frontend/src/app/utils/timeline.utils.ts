const TIMELINE_EDGE_PERCENT = 1.5;

export function formatTimelineMarkerLabel(groupKey: string): string {
  const [year, month, day] = groupKey.split('-').map((part) => Number(part));
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date(year, (month || 1) - 1, day || 1));
}

export function formatTimelineCurrentLabel(groupKey: string): string {
  const [year, month] = groupKey.split('-').map((part) => Number(part));
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    year: 'numeric'
  }).format(new Date(year, (month || 1) - 1, 1));
}

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function getTimelineScrollOffset(): number {
  return 24;
}

export function getGroupScrollTopAdjustment(section: HTMLElement): number {
  const header = section.querySelector('.gallery-group-header') as HTMLElement | null;
  return header ? Math.max(0, header.offsetTop) : 0;
}

export function toTimelinePercent(progress: number): number {
  const boundedProgress = clampPercent(progress * 100) / 100;
  const safeRange = 100 - (TIMELINE_EDGE_PERCENT * 2);
  return clampPercent(TIMELINE_EDGE_PERCENT + (boundedProgress * safeRange));
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
