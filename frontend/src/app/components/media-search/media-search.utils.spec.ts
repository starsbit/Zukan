import { describe, expect, it } from 'vitest';

import {
  buildMediaListQuery,
  countActiveAdvancedFilters,
  createDefaultMediaSearchFilters,
  normalizeCharacterSearchValue,
  parseMediaSearchText,
  replaceActiveToken
} from './media-search.utils';

describe('gallery search utils', () => {
  it('parses tag and character tokens into a media query payload', () => {
    expect(parseMediaSearchText('tag:sky fox character:ayanami_rei tag:blue')).toEqual({
      tags: ['sky', 'fox', 'blue'],
      characterName: 'ayanami_rei'
    });
  });

  it('normalizes character search values with spaces and punctuation', () => {
    expect(normalizeCharacterSearchValue('Sumika (Muvluv)')).toBe('sumika_muvluv');
  });

  it('replaces only the active token when a suggestion is chosen', () => {
    expect(replaceActiveToken('tag:sky cha', 'character:ayanami_rei')).toBe('tag:sky character:ayanami_rei ');
  });

  it('builds the default gallery query with explicit filters', () => {
    const filters = createDefaultMediaSearchFilters();
    filters.favorited = 'only';
    filters.album_id = 'album-7';
    filters.media_type = ['video'];
    filters.status = ['done', 'pending'];

    expect(buildMediaListQuery('tag:sky character:ayanami_rei', filters)).toMatchObject({
      page_size: 60,
      album_id: 'album-7',
      status: 'done,pending',
      character_name: 'ayanami_rei',
      favorited: true,
      media_type: ['video']
    });
  });

  it('normalizes character search tokens before building the media query', () => {
    expect(buildMediaListQuery('character:Sumika (Muvluv)', createDefaultMediaSearchFilters())).toMatchObject({
      character_name: 'sumika_muvluv'
    });
  });

  it('keeps completed uploads visible in the default status filter, including failures', () => {
    expect(createDefaultMediaSearchFilters().status).toEqual(['pending', 'processing', 'done', 'failed']);
  });

  it('includes failed media in the default gallery query', () => {
    expect(buildMediaListQuery('', createDefaultMediaSearchFilters())).toMatchObject({
      status: 'pending,processing,done,failed'
    });
  });

  it('counts active advanced filters relative to defaults', () => {
    const filters = createDefaultMediaSearchFilters();
    filters.album_id = 'album-2';
    filters.nsfw = 'include';
    filters.captured_before = '2026-03-21T10:00';

    expect(countActiveAdvancedFilters(filters)).toBe(3);
  });
});
