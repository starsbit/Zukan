import { Injectable, signal } from '@angular/core';

const HIDE_NSFW_KEY = 'zukan-hide-nsfw-badge';
const HIDE_SENSITIVE_KEY = 'zukan-hide-sensitive-badge';

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch { /* SSR / test environment */ }
}

@Injectable({ providedIn: 'root' })
export class BadgeVisibilityService {
  private readonly _hideNsfw = signal(readBool(HIDE_NSFW_KEY));
  private readonly _hideSensitive = signal(readBool(HIDE_SENSITIVE_KEY));

  readonly hideNsfw = this._hideNsfw.asReadonly();
  readonly hideSensitive = this._hideSensitive.asReadonly();

  setHideNsfw(value: boolean): void {
    writeBool(HIDE_NSFW_KEY, value);
    this._hideNsfw.set(value);
  }

  setHideSensitive(value: boolean): void {
    writeBool(HIDE_SENSITIVE_KEY, value);
    this._hideSensitive.set(value);
  }
}
