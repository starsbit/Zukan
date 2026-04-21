import { MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../models/media';

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

const durationFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
});

export function humanizeBackendLabel(value: string | null | undefined): string {
  if (!value?.trim()) {
    return '';
  }

  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatMetadataName(value: string | null | undefined): string {
  if (!value?.trim()) {
    return '';
  }

  const normalized = value
    .trim()
    .replace(/[_]+/g, ' ')
    .replace(/\(\s*/g, ' (')
    .replace(/\s*\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.replace(/(^|[\s(/-])([a-z])/g, (_match, prefix: string, char: string) =>
    `${prefix}${char.toUpperCase()}`,
  );
}

export function normalizeMetadataNameForSubmission(value: string | null | undefined): string {
  if (!value?.trim()) {
    return '';
  }

  return value
    .trim()
    .normalize('NFKC')
    .replace(/['".,!?]+/g, '_')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9()]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) {
    return '';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value?.trim()) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return dateTimeFormatter.format(date);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return '';
  }

  if (seconds < 60) {
    return `${durationFormatter.format(seconds)} sec`;
  }

  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  const parts = [
    hours > 0 ? `${hours} hr` : null,
    minutes > 0 ? `${minutes} min` : null,
    remainingSeconds > 0 || (hours === 0 && minutes === 0) ? `${remainingSeconds} sec` : null,
  ].filter((part): part is string => !!part);

  return parts.join(' ');
}

export function formatConfidence(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '';
  }

  return percentFormatter.format(value);
}

export function formatDimensions(width: number | null | undefined, height: number | null | undefined): string {
  if (width == null || height == null) {
    return '';
  }

  return `${width} x ${height}`;
}

export function formatMediaType(value: MediaType | string | null | undefined): string {
  if (!value) {
    return '';
  }

  if (value === MediaType.GIF) {
    return 'GIF';
  }

  return humanizeBackendLabel(value);
}

export function formatVisibility(value: MediaVisibility | string | null | undefined): string {
  return humanizeBackendLabel(value ?? '');
}

export function formatProcessingStatus(value: ProcessingStatus | TaggingStatus | string | null | undefined): string {
  return humanizeBackendLabel(value ?? '');
}
