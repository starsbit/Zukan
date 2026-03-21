import { Injectable } from '@angular/core';

export interface ClientAuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ClientAuthStore {
  private readonly accessTokenKey = 'zukan.web.access_token';
  private readonly refreshTokenKey = 'zukan.web.refresh_token';
  private readonly tokenTypeKey = 'zukan.web.token_type';
  private readonly memoryStorage = new Map<string, string>();

  getAccessToken(): string | null {
    return this.read(this.accessTokenKey);
  }

  getRefreshToken(): string | null {
    return this.read(this.refreshTokenKey);
  }

  getTokenType(): string | null {
    return this.read(this.tokenTypeKey);
  }

  setTokens(tokens: ClientAuthTokens): void {
    this.write(this.accessTokenKey, tokens.accessToken);
    this.write(this.refreshTokenKey, tokens.refreshToken);

    if (tokens.tokenType) {
      this.write(this.tokenTypeKey, tokens.tokenType);
      return;
    }

    this.remove(this.tokenTypeKey);
  }

  clearTokens(): void {
    this.remove(this.accessTokenKey);
    this.remove(this.refreshTokenKey);
    this.remove(this.tokenTypeKey);
  }

  private read(key: string): string | null {
    const storage = this.storage;
    if (storage) {
      return storage.getItem(key);
    }

    return this.memoryStorage.get(key) ?? null;
  }

  private write(key: string, value: string): void {
    const storage = this.storage;
    if (storage) {
      storage.setItem(key, value);
      return;
    }

    this.memoryStorage.set(key, value);
  }

  private remove(key: string): void {
    const storage = this.storage;
    if (storage) {
      storage.removeItem(key);
      return;
    }

    this.memoryStorage.delete(key);
  }

  private get storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    if (
      typeof localStorage.getItem !== 'function' ||
      typeof localStorage.setItem !== 'function' ||
      typeof localStorage.removeItem !== 'function'
    ) {
      return null;
    }

    return localStorage;
  }
}
