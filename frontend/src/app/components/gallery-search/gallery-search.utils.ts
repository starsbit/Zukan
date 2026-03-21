import { ListMediaQuery } from '../../models/api';
import { GallerySearchFilters } from './gallery-search.models';

const DEFAULT_PAGE_SIZE = 60;
const TAG_PREFIX = 'tag:';
const CHARACTER_PREFIX = 'character:';

export interface ParsedGallerySearchText {
  tags: string[];
  characterName: string | null;
}

export interface GalleryAutocompleteContext {
  mode: 'tag' | 'character' | 'all';
  query: string;
}

export function createDefaultGallerySearchFilters(): GallerySearchFilters {
  return {
    favorited: 'any',
    nsfw: 'default',
    status: ['done'],
    media_type: [],
    captured_after: null,
    captured_before: null
  };
}

export function parseGallerySearchText(searchText: string): ParsedGallerySearchText {
  const tags: string[] = [];
  let characterName: string | null = null;

  for (const token of tokenizeSearchText(searchText)) {
    if (token.startsWith(CHARACTER_PREFIX)) {
      const value = token.slice(CHARACTER_PREFIX.length).trim();
      if (value) {
        characterName = value;
      }
      continue;
    }

    const normalizedTag = token.startsWith(TAG_PREFIX)
      ? token.slice(TAG_PREFIX.length).trim()
      : token.trim();

    if (normalizedTag) {
      tags.push(normalizedTag);
    }
  }

  return {
    tags: [...new Set(tags)],
    characterName
  };
}

export function getAutocompleteContext(searchText: string): GalleryAutocompleteContext | null {
  const activeToken = getActiveToken(searchText);
  if (!activeToken) {
    return null;
  }

  if (activeToken.startsWith(CHARACTER_PREFIX)) {
    const query = activeToken.slice(CHARACTER_PREFIX.length).trim();
    return query ? { mode: 'character', query } : null;
  }

  if (activeToken.startsWith(TAG_PREFIX)) {
    const query = activeToken.slice(TAG_PREFIX.length).trim();
    return query ? { mode: 'tag', query } : null;
  }

  return activeToken.trim() ? { mode: 'all', query: activeToken.trim() } : null;
}

export function replaceActiveToken(searchText: string, replacementToken: string): string {
  const trimmedEnd = searchText.replace(/\s+$/, '');
  if (!trimmedEnd) {
    return `${replacementToken} `;
  }

  const parts = trimmedEnd.split(/\s+/);
  parts[parts.length - 1] = replacementToken;
  return `${parts.join(' ')} `;
}

export function buildGalleryListQuery(searchText: string, filters: GallerySearchFilters): ListMediaQuery {
  const parsed = parseGallerySearchText(searchText);
  const capturedAfter = toIsoString(filters.captured_after);
  const capturedBefore = toIsoString(filters.captured_before);

  return {
    page: 1,
    page_size: DEFAULT_PAGE_SIZE,
    status: filters.status.length > 0 ? filters.status : null,
    tags: parsed.tags.length > 0 ? parsed.tags.join(',') : null,
    character_name: parsed.characterName,
    favorited: filters.favorited === 'only' ? true : null,
    nsfw: filters.nsfw,
    media_type: filters.media_type.length > 0 ? filters.media_type : null,
    captured_after: capturedAfter,
    captured_before: capturedBefore
  };
}

export function countActiveAdvancedFilters(filters: GallerySearchFilters): number {
  const defaults = createDefaultGallerySearchFilters();
  return [
    filters.favorited !== defaults.favorited,
    filters.nsfw !== defaults.nsfw,
    !hasSameValues(filters.status, defaults.status),
    !hasSameValues(filters.media_type, defaults.media_type),
    filters.captured_after !== defaults.captured_after,
    filters.captured_before !== defaults.captured_before
  ].filter(Boolean).length;
}

function tokenizeSearchText(searchText: string): string[] {
  return searchText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function getActiveToken(searchText: string): string {
  const trimmedEnd = searchText.replace(/\s+$/, '');
  if (!trimmedEnd) {
    return '';
  }

  const parts = trimmedEnd.split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

function toIsoString(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = new Date(value);
  return Number.isNaN(normalized.getTime()) ? null : normalized.toISOString();
}

function hasSameValues(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}
