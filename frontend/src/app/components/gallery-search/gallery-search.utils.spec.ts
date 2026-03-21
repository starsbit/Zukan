import { describe, expect, it } from 'vitest';

import { buildGalleryListQuery, countActiveAdvancedFilters, createDefaultGallerySearchFilters, parseGallerySearchText, replaceActiveToken } from './gallery-search.utils';

describe('gallery search utils', () => {
  it('parses tag and character tokens into a media query payload', () => {
    expect(parseGallerySearchText('tag:sky fox character:ayanami_rei tag:blue')).toEqual({
      tags: ['sky', 'fox', 'blue'],
      characterName: 'ayanami_rei'
    });
  });

  it('replaces only the active token when a suggestion is chosen', () => {
    expect(replaceActiveToken('tag:sky cha', 'character:ayanami_rei')).toBe('tag:sky character:ayanami_rei ');
  });

  it('builds the default gallery query with explicit filters', () => {
    const filters = createDefaultGallerySearchFilters();
    filters.favorited = 'only';
    filters.media_type = ['video'];
    filters.status = ['done', 'pending'];

    expect(buildGalleryListQuery('tag:sky character:ayanami_rei', filters)).toMatchObject({
      page: 1,
      page_size: 60,
      status: ['done', 'pending'],
      tags: 'sky',
      character_name: 'ayanami_rei',
      favorited: true,
      media_type: ['video']
    });
  });

  it('includes in-flight uploads in the default status filter', () => {
    expect(createDefaultGallerySearchFilters().status).toEqual(['pending', 'processing', 'done']);
  });

  it('counts active advanced filters relative to defaults', () => {
    const filters = createDefaultGallerySearchFilters();
    filters.nsfw = 'include';
    filters.captured_before = '2026-03-21T10:00';

    expect(countActiveAdvancedFilters(filters)).toBe(2);
  });
});
