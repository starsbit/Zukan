import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { TokenResponse } from '../../models/auth';

export const LOCAL_STORAGE = new InjectionToken<Storage>('LOCAL_STORAGE', {
  providedIn: 'root',
  factory: () => window.localStorage,
});

export const SESSION_STORAGE = new InjectionToken<Storage>('SESSION_STORAGE', {
  providedIn: 'root',
  factory: () => window.sessionStorage,
});

const AT_KEY = 'zukan_at';
const RT_KEY = 'zukan_rt';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly ls = inject(LOCAL_STORAGE);
  private readonly ss = inject(SESSION_STORAGE);

  private readonly _accessToken = signal<string | null>(null);
  private readonly _refreshToken = signal<string | null>(null);

  readonly isAuthenticated = computed(() => this._accessToken() !== null);

  /** Used by the auth interceptor to coordinate concurrent refresh requests. */
  isRefreshing = false;
  readonly refreshResult$ = new BehaviorSubject<string | null>(null);

  constructor() {
    const at = this.ls.getItem(AT_KEY) ?? this.ss.getItem(AT_KEY);
    const rt = this.ls.getItem(RT_KEY) ?? this.ss.getItem(RT_KEY);
    this._accessToken.set(at);
    this._refreshToken.set(rt);
  }

  setTokens(tokens: TokenResponse, persist: boolean): void {
    if (persist) {
      this.ss.removeItem(AT_KEY);
      this.ss.removeItem(RT_KEY);
      this.ls.setItem(AT_KEY, tokens.access_token);
      this.ls.setItem(RT_KEY, tokens.refresh_token);
    } else {
      this.ls.removeItem(AT_KEY);
      this.ls.removeItem(RT_KEY);
      this.ss.setItem(AT_KEY, tokens.access_token);
      this.ss.setItem(RT_KEY, tokens.refresh_token);
    }
    this._accessToken.set(tokens.access_token);
    this._refreshToken.set(tokens.refresh_token);
  }

  getAccessToken(): string | null {
    return this._accessToken();
  }

  getRefreshToken(): string | null {
    return this._refreshToken();
  }

  isPersisted(): boolean {
    return this.ls.getItem(AT_KEY) !== null;
  }

  clear(): void {
    this.ls.removeItem(AT_KEY);
    this.ls.removeItem(RT_KEY);
    this.ss.removeItem(AT_KEY);
    this.ss.removeItem(RT_KEY);
    this._accessToken.set(null);
    this._refreshToken.set(null);
  }
}
