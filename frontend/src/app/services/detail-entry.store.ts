import { Injectable } from '@angular/core';
import { RelatedMediaRead } from '../models/media';

export interface DetailEntry {
  mediaId: string;
  similarItems: RelatedMediaRead[];
  cursor: string | null;
  hasMore: boolean;
  loaded: boolean;
  scrollTop: number;
}

const MAX_ENTRIES = 30;

@Injectable({ providedIn: 'root' })
export class DetailEntryStore {
  private readonly entries = new Map<string, DetailEntry>();

  get(key: string): DetailEntry | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  set(key: string, entry: DetailEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.entries.delete(oldest);
    }
  }
}
