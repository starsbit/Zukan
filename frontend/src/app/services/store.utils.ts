export interface RequestStatus {
  loading: boolean;
  loaded: boolean;
  error: unknown | null;
}

export function createRequestStatus(): RequestStatus {
  return {
    loading: false,
    loaded: false,
    error: null
  };
}

export function beginRequest(status: RequestStatus): RequestStatus {
  return {
    ...status,
    loading: true,
    error: null
  };
}

export function completeRequest(status: RequestStatus): RequestStatus {
  return {
    ...status,
    loading: false,
    loaded: true,
    error: null
  };
}

export function failRequest(status: RequestStatus, error: unknown): RequestStatus {
  return {
    ...status,
    loading: false,
    error
  };
}

export function patchItemById<T extends { id: string | number }>(
  items: T[],
  id: T['id'],
  patch: Partial<T>
): T[] {
  return items.map((item) => item.id === id ? { ...item, ...patch } : item);
}

export function replaceItemById<T extends { id: string | number }>(
  items: T[],
  nextItem: T
): T[] {
  return items.map((item) => item.id === nextItem.id ? nextItem : item);
}

export function removeItemById<T extends { id: string | number }>(
  items: T[],
  id: T['id']
): T[] {
  return items.filter((item) => item.id !== id);
}
