import { describe, expect, it } from 'vitest';
import { MediaVisibility } from '../../models/media';
import { buildFavoritesParams } from './favorites.params';

describe('buildFavoritesParams', () => {
  it('forces favorites mode without inheriting shared visibility or favorited filters', () => {
    expect(buildFavoritesParams({
      tag: ['Saber'],
      visibility: MediaVisibility.PRIVATE,
      favorited: false,
      character_name: ['Rin Tohsaka'],
    })).toEqual({
      tag: ['Saber'],
      character_name: ['Rin Tohsaka'],
      favorited: true,
      state: 'active',
    });
  });

  it('preserves other active filters while forcing favorites mode', () => {
    expect(buildFavoritesParams({
      exclude_tag: ['spoiler'],
      status: 'reviewed',
      media_type: ['video'],
      ocr_text: 'moonlight',
      visibility: MediaVisibility.PUBLIC,
    })).toEqual({
      exclude_tag: ['spoiler'],
      status: 'reviewed',
      media_type: ['video'],
      ocr_text: 'moonlight',
      favorited: true,
      state: 'active',
    });
  });
});
