import { describe, expect, it } from 'vitest';
import { DetailEntry, DetailEntryStore } from './detail-entry.store';

function entry(mediaId: string): DetailEntry {
  return { mediaId, similarItems: [], cursor: null, hasMore: false, loaded: true, scrollTop: 0 };
}

describe('DetailEntryStore', () => {
  it('evicts the least recently used entry beyond 30', () => {
    const store = new DetailEntryStore();
    for (let index = 0; index < 30; index += 1) {
      store.set(`k${index}`, entry(`m${index}`));
    }

    store.get('k0');
    store.set('k30', entry('m30'));

    expect(store.get('k0')?.mediaId).toBe('m0');
    expect(store.get('k1')).toBeUndefined();
    expect(store.get('k30')?.mediaId).toBe('m30');
  });
});
