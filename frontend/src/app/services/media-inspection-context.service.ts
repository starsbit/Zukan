import { Injectable, signal } from '@angular/core';
import { MediaRead } from '../models/media';

export interface MediaInspectorReturnAnchor {
  sequence: number;
  mediaId: string;
  originUrl: string;
  scrollY: number;
  viewportTop: number;
}

export type MediaInspectorReturnAnchorInput = Omit<MediaInspectorReturnAnchor, 'sequence'>;

@Injectable({ providedIn: 'root' })
export class MediaInspectionContextService {
  private readonly _items = signal<MediaRead[]>([]);
  private readonly _originUrl = signal<string | null>(null);
  private readonly _returnAnchor = signal<MediaInspectorReturnAnchor | null>(null);
  private nextReturnAnchorSequence = 1;

  readonly items = this._items.asReadonly();
  readonly originUrl = this._originUrl.asReadonly();
  readonly returnAnchor = this._returnAnchor.asReadonly();

  setContext(
    items: MediaRead[],
    originUrl: string,
    returnAnchor: MediaInspectorReturnAnchorInput | null = null,
  ): void {
    this._items.set([...items]);
    this._originUrl.set(originUrl);
    this._returnAnchor.set(
      returnAnchor
        ? { ...returnAnchor, sequence: this.nextReturnAnchorSequence++ }
        : null,
    );
  }

  patchItem(updated: MediaRead): void {
    this._items.update((items) =>
      items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
    );
  }

  clear(): void {
    this._items.set([]);
    this._originUrl.set(null);
    this._returnAnchor.set(null);
  }

  consumeReturnAnchor(sequence?: number): void {
    if (sequence !== undefined && this._returnAnchor()?.sequence !== sequence) {
      return;
    }
    this._returnAnchor.set(null);
  }
}
