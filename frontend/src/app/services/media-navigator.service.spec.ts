import { describe, expect, it } from 'vitest';
import { isSameFeedTransition, parseMediaUrl } from './media-navigator.service';

describe('parseMediaUrl', () => {
  it('treats the root as the gallery feed', () => {
    expect(parseMediaUrl('/')).toEqual({ feedPath: '/gallery', mediaId: null, query: '' });
  });

  it('reads a detail under a feed with its query', () => {
    expect(parseMediaUrl('/album/a1/media/m1?tag=x#frag')).toEqual({
      feedPath: '/album/a1',
      mediaId: 'm1',
      query: 'tag=x',
    });
  });

  it('has no feed for a standalone detail', () => {
    expect(parseMediaUrl('/media/m1')).toEqual({ feedPath: null, mediaId: 'm1', query: '' });
  });
});

describe('isSameFeedTransition', () => {
  it('is true when the layer opens, closes or changes over one feed', () => {
    expect(isSameFeedTransition('/', '/gallery/media/m1')).toBe(true);
    expect(isSameFeedTransition('/gallery/media/m1?tag=x', '/gallery?tag=x')).toBe(true);
    expect(isSameFeedTransition('/trash/media/m1', '/trash/media/m2')).toBe(true);
  });

  it('is false when the feed or its filters change', () => {
    expect(isSameFeedTransition('/gallery/media/m1', '/gallery?tag=x')).toBe(false);
    expect(isSameFeedTransition('/gallery/media/m1', '/favorites')).toBe(false);
    expect(isSameFeedTransition('/media/m1', '/gallery')).toBe(false);
  });

  it('is false for ordinary navigation and the first navigation', () => {
    expect(isSameFeedTransition('/gallery', '/gallery')).toBe(false);
    expect(isSameFeedTransition(null, '/gallery/media/m1')).toBe(false);
  });
});
