import { inject, Injectable, signal } from '@angular/core';
import { SESSION_STORAGE } from './web/auth.store';

const DEMO_KEY = 'zukan_demo';
const NOTICE_KEY = 'zukan_demo_notice_seen';

@Injectable({ providedIn: 'root' })
export class DemoModeService {
  private readonly storage = inject(SESSION_STORAGE);
  private readonly _enabled = signal(this.storage.getItem(DEMO_KEY) === '1');
  private readonly _noticeSeen = signal(this.storage.getItem(NOTICE_KEY) === '1');

  readonly enabled = this._enabled.asReadonly();
  readonly noticeSeen = this._noticeSeen.asReadonly();

  set(enabled: boolean): void {
    if (enabled) {
      this.storage.setItem(DEMO_KEY, '1');
    } else {
      this.storage.removeItem(DEMO_KEY);
    }
    this._enabled.set(enabled);
  }

  markNoticeSeen(): void {
    this.storage.setItem(NOTICE_KEY, '1');
    this._noticeSeen.set(true);
  }
}
