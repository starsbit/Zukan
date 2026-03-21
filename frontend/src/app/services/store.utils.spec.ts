import { beginRequest, completeRequest, createRequestStatus, failRequest, patchItemById, removeItemById, replaceItemById } from './store.utils';

describe('store.utils', () => {
  it('creates and transitions request status objects', () => {
    const initial = createRequestStatus();
    expect(initial).toEqual({
      loading: false,
      loaded: false,
      error: null
    });

    const loading = beginRequest(initial);
    expect(loading).toEqual({
      loading: true,
      loaded: false,
      error: null
    });

    const failed = failRequest(loading, 'boom');
    expect(failed).toEqual({
      loading: false,
      loaded: false,
      error: 'boom'
    });

    const completed = completeRequest(failed);
    expect(completed).toEqual({
      loading: false,
      loaded: true,
      error: null
    });
  });

  it('patches, replaces, and removes items by id', () => {
    const items = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 }
    ];

    expect(patchItemById(items, 'b', { value: 3 })).toEqual([
      { id: 'a', value: 1 },
      { id: 'b', value: 3 }
    ]);

    expect(replaceItemById(items, { id: 'a', value: 9 })).toEqual([
      { id: 'a', value: 9 },
      { id: 'b', value: 2 }
    ]);

    expect(removeItemById(items, 'a')).toEqual([
      { id: 'b', value: 2 }
    ]);
  });
});
