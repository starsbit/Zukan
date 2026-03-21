import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, catchError, distinctUntilChanged, map, Observable, tap, throwError } from 'rxjs';

import { ListTagsQuery, TagRead } from '../models/api';
import { beginRequest, completeRequest, createRequestStatus, failRequest, type RequestStatus } from './store.utils';
import { TagsClientService } from './web/tags-client.service';

export interface TagsState {
  tags: TagRead[];
  activeQuery: ListTagsQuery | null;
  resultsByKey: Record<string, TagRead[]>;
  request: RequestStatus;
}

const initialTagsState = (): TagsState => ({
  tags: [],
  activeQuery: null,
  resultsByKey: {},
  request: createRequestStatus()
});

@Injectable({
  providedIn: 'root'
})
export class TagsService {
  private readonly tagsClient = inject(TagsClientService);
  private readonly stateSubject = new BehaviorSubject<TagsState>(initialTagsState());

  readonly state$ = this.stateSubject.asObservable();
  readonly tags$ = this.state$.pipe(
    map((state) => state.tags),
    distinctUntilChanged()
  );
  readonly loading$ = this.state$.pipe(
    map((state) => state.request.loading),
    distinctUntilChanged()
  );
  readonly loaded$ = this.state$.pipe(
    map((state) => state.request.loaded),
    distinctUntilChanged()
  );
  readonly error$ = this.state$.pipe(
    map((state) => state.request.error),
    distinctUntilChanged()
  );

  get snapshot(): TagsState {
    return this.stateSubject.value;
  }

  search(query?: ListTagsQuery): Observable<TagRead[]> {
    const key = serializeQuery(query);
    const cached = this.stateSubject.value.resultsByKey[key];

    this.patchState({
      activeQuery: query ?? null
    });

    if (cached) {
      this.patchState({
        tags: cached,
        request: completeRequest(this.stateSubject.value.request)
      });

      return new Observable<TagRead[]>((subscriber) => {
        subscriber.next(cached);
        subscriber.complete();
      });
    }

    this.patchState({
      request: beginRequest(this.stateSubject.value.request)
    });

    return this.tagsClient.list(query).pipe(
      tap((tags) => {
        this.patchState({
          tags,
          resultsByKey: {
            ...this.stateSubject.value.resultsByKey,
            [key]: tags
          },
          request: completeRequest(this.stateSubject.value.request)
        });
      }),
      catchError((error) => {
        this.patchState({
          request: failRequest(this.stateSubject.value.request, error)
        });
        return throwError(() => error);
      })
    );
  }

  clear(): void {
    this.stateSubject.next(initialTagsState());
  }

  private patchState(patch: Partial<TagsState>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch
    });
  }
}

function serializeQuery(query?: ListTagsQuery): string {
  return JSON.stringify(query ?? {});
}
