import { describe, expect, it } from 'vitest';
import { buildFavoritesParams } from './favorites.params';

describe('buildFavoritesParams', () => {
  it('preserves other active filters while forcing favorites mode', () => {
    expect(
      buildFavoritesParams({
        exclude_tag: ['spoiler'],
        status: 'reviewed',
        media_type: ['video'],
        ocr_text: 'moonlight',
      }),
    ).toEqual({
      exclude_tag: ['spoiler'],
      status: 'reviewed',
      media_type: ['video'],
      ocr_text: 'moonlight',
      favorited: true,
      state: 'active',
    });
  });
});
