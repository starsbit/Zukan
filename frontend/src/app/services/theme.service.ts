import { DOCUMENT } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'zukan-theme-mode';
const LIGHT_THEME_CLASS = 'theme-light';
const DARK_THEME_CLASS = 'theme-dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly modeSignal = signal<ThemeMode>('light');

  readonly mode = computed(() => this.modeSignal());
  readonly isDarkMode = computed(() => this.mode() === 'dark');

  initialize(): void {
    const initialMode = this.getStoredMode() ?? this.getPreferredColorScheme();
    this.setMode(initialMode);
  }

  toggleMode(): void {
    this.setMode(this.isDarkMode() ? 'light' : 'dark');
  }

  private setMode(mode: ThemeMode): void {
    this.modeSignal.set(mode);

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const root = this.document.documentElement;
    root.classList.remove(LIGHT_THEME_CLASS, DARK_THEME_CLASS);
    root.classList.add(mode === 'dark' ? DARK_THEME_CLASS : LIGHT_THEME_CLASS);
    root.style.colorScheme = mode;
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  }

  private getStoredMode(): ThemeMode | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    const storedMode = localStorage.getItem(THEME_STORAGE_KEY);
    return storedMode === 'light' || storedMode === 'dark' ? storedMode : null;
  }

  private getPreferredColorScheme(): ThemeMode {
    if (!isPlatformBrowser(this.platformId)) {
      return 'light';
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}
