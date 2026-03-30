import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AuthStore, LOCAL_STORAGE, SESSION_STORAGE } from './auth.store';

const mockTokens = { access_token: 'access-abc', refresh_token: 'refresh-xyz', token_type: 'bearer' };

function createStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}

describe('AuthStore', () => {
  let ls: Storage;
  let ss: Storage;

  beforeEach(() => {
    ls = createStorage();
    ss = createStorage();

    TestBed.configureTestingModule({
      providers: [
        { provide: LOCAL_STORAGE, useValue: ls },
        { provide: SESSION_STORAGE, useValue: ss },
      ],
    });
  });

  it('initialises unauthenticated when storage is empty', () => {
    const store = TestBed.inject(AuthStore);
    expect(store.isAuthenticated()).toBe(false);
    expect(store.getAccessToken()).toBeNull();
    expect(store.getRefreshToken()).toBeNull();
  });

  it('hydrates from localStorage on construction', () => {
    ls.setItem('zukan_at', 'stored-at');
    ls.setItem('zukan_rt', 'stored-rt');
    const store = TestBed.inject(AuthStore);
    expect(store.isAuthenticated()).toBe(true);
    expect(store.getAccessToken()).toBe('stored-at');
    expect(store.getRefreshToken()).toBe('stored-rt');
  });

  it('hydrates from sessionStorage when localStorage is empty', () => {
    ss.setItem('zukan_at', 'sess-at');
    ss.setItem('zukan_rt', 'sess-rt');
    const store = TestBed.inject(AuthStore);
    expect(store.getAccessToken()).toBe('sess-at');
  });

  it('setTokens with persist=true writes to localStorage', () => {
    const store = TestBed.inject(AuthStore);
    store.setTokens(mockTokens, true);
    expect(ls.getItem('zukan_at')).toBe('access-abc');
    expect(ls.getItem('zukan_rt')).toBe('refresh-xyz');
    expect(ss.getItem('zukan_at')).toBeNull();
    expect(store.isAuthenticated()).toBe(true);
    expect(store.isPersisted()).toBe(true);
  });

  it('setTokens with persist=false writes to sessionStorage', () => {
    const store = TestBed.inject(AuthStore);
    store.setTokens(mockTokens, false);
    expect(ss.getItem('zukan_at')).toBe('access-abc');
    expect(ls.getItem('zukan_at')).toBeNull();
    expect(store.isPersisted()).toBe(false);
  });

  it('setTokens clears opposite storage', () => {
    ls.setItem('zukan_at', 'old');
    ls.setItem('zukan_rt', 'old-rt');
    const store = TestBed.inject(AuthStore);
    store.setTokens(mockTokens, false);
    expect(ls.getItem('zukan_at')).toBeNull();
    expect(ss.getItem('zukan_at')).toBe('access-abc');
  });

  it('clear removes tokens from both storages and signals unauthenticated', () => {
    ls.setItem('zukan_at', 'at');
    ls.setItem('zukan_rt', 'rt');
    const store = TestBed.inject(AuthStore);
    store.clear();
    expect(ls.getItem('zukan_at')).toBeNull();
    expect(ss.getItem('zukan_at')).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.getAccessToken()).toBeNull();
  });

  it('isPersisted returns false when only sessionStorage has token', () => {
    ss.setItem('zukan_at', 'sess-at');
    const store = TestBed.inject(AuthStore);
    expect(store.isPersisted()).toBe(false);
  });
});
