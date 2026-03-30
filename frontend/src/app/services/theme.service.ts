import { effect, Injectable, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'zukan-theme';

function readStorage(): ThemePreference {
  try {
    return (localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? 'system';
  } catch {
    return 'system';
  }
}

function writeStorage(value: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch { /* SSR / test environment */ }
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _preference = signal<ThemePreference>(readStorage());

  readonly preference = this._preference.asReadonly();

  constructor() {
    effect(() => {
      const p = this._preference();
      const html = document.documentElement;
      html.classList.remove('theme-light', 'theme-dark');
      if (p !== 'system') {
        html.classList.add(`theme-${p}`);
      }
    });
  }

  cycle(): void {
    const next: Record<ThemePreference, ThemePreference> = {
      system: 'dark',
      dark: 'light',
      light: 'system',
    };
    this.set(next[this._preference()]);
  }

  set(preference: ThemePreference): void {
    writeStorage(preference);
    this._preference.set(preference);
  }
}
