import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

import { CharacterSuggestion } from '../models/api';
import { MediaClientService } from './web/media-client.service';

@Injectable({
  providedIn: 'root'
})
export class CharacterSuggestionsService {
  private readonly mediaClient = inject(MediaClientService);
  private readonly cache = new Map<string, CharacterSuggestion[]>();

  search(query: string, limit = 10): Observable<CharacterSuggestion[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return of([]);
    }

    const key = `${normalizedQuery}:${limit}`;
    const cached = this.cache.get(key);
    if (cached) {
      return of(cached);
    }

    return this.mediaClient.listCharacterSuggestions({ q: normalizedQuery, limit }).pipe(
      tap((results) => {
        this.cache.set(key, results);
      })
    );
  }

  clear(): void {
    this.cache.clear();
  }
}
