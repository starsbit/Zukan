import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlobUrlCache } from './blob-url.utils';

describe('BlobUrlCache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('evicts and revokes the oldest object URLs when over capacity', () => {
    let counter = 0;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++counter}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const cache = new BlobUrlCache(2);

    expect(cache.set('a', new Blob(['a']))).toBe('blob:1');
    expect(cache.set('b', new Blob(['b']))).toBe('blob:2');
    expect(cache.set('c', new Blob(['c']))).toBe('blob:3');

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('blob:2');
    expect(cache.get('c')).toBe('blob:3');
    expect(create).toHaveBeenCalledTimes(3);
    expect(revoke).toHaveBeenCalledWith('blob:1');
  });
});
