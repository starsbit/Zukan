import { Injectable, signal } from '@angular/core';
import { MediaRead } from '../models/media';

@Injectable({ providedIn: 'root' })
export class MediaInspectionContextService {
  private readonly _items = signal<MediaRead[]>([]);
  private readonly _originUrl = signal<string | null>(null);

  readonly items = this._items.asReadonly();
  readonly originUrl = this._originUrl.asReadonly();

  setContext(items: MediaRead[], originUrl: string): void {
    this._items.set([...items]);
    this._originUrl.set(originUrl);
  }

  patchItem(updated: MediaRead): void {
    this._items.update((items) =>
      items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
    );
  }

  clear(): void {
    this._items.set([]);
    this._originUrl.set(null);
  }
}
