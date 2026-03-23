import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, catchError, distinctUntilChanged, finalize, map, Observable, tap, throwError } from 'rxjs';

import { ListTagsQuery, TagManagementResult, TagRead } from '../models/api';
import { beginRequest, completeRequest, createRequestStatus, failRequest, type RequestStatus } from './store.utils';
import { TagsClientService } from './web/tags-client.service';

export interface TagsState {
  tags: TagRead[];
  activeQuery: ListTagsQuery | null;
  resultsByKey: Record<string, TagRead[]>;
  request: RequestStatus;
  mutationPending: boolean;
  mutationError: unknown | null;
}

const initialTagsState = (): TagsState => ({
  tags: [],
  activeQuery: null,
  resultsByKey: {},
  request: createRequestStatus(),
  mutationPending: false,
  mutationError: null
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
    map((state) => state.request.loading || state.mutationPending),
    distinctUntilChanged()
  );
  readonly loaded$ = this.state$.pipe(
    map((state) => state.request.loaded),
    distinctUntilChanged()
  );
  readonly error$ = this.state$.pipe(
    map((state) => state.mutationError ?? state.request.error),
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
      map((res) => res.items),
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

  deleteTag(tagId: number, tagName: string): Observable<TagManagementResult> {
    this.startMutation();

    return this.tagsClient.removeTagFromMedia(tagId).pipe(
      tap((result) => {
        this.invalidateResults((tag) => tag.name !== tagName);
        this.finishMutation();
        return result;
      }),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  trashMediaByTag(tagId: number): Observable<TagManagementResult> {
    this.startMutation();

    return this.tagsClient.trashMediaByTag(tagId).pipe(
      tap(() => this.finishMutation()),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  deleteCharacterName(characterName: string): Observable<TagManagementResult> {
    this.startMutation();

    return this.tagsClient.removeCharacterNameFromMedia(characterName).pipe(
      tap(() => this.finishMutation()),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  trashMediaByCharacterName(characterName: string): Observable<TagManagementResult> {
    this.startMutation();

    return this.tagsClient.trashMediaByCharacterName(characterName).pipe(
      tap(() => this.finishMutation()),
      catchError((error) => this.failMutation(error)),
      finalize(() => this.ensureMutationSettled())
    );
  }

  clear(): void {
    this.stateSubject.next(initialTagsState());
  }

  private startMutation(): void {
    this.patchState({
      mutationPending: true,
      mutationError: null
    });
  }

  private finishMutation(): void {
    this.patchState({
      mutationPending: false,
      mutationError: null
    });
  }

  private failMutation(error: unknown): Observable<never> {
    this.patchState({
      mutationPending: false,
      mutationError: error
    });

    return throwError(() => error);
  }

  private ensureMutationSettled(): void {
    if (!this.stateSubject.value.mutationPending) {
      return;
    }

    this.patchState({
      mutationPending: false
    });
  }

  private invalidateResults(predicate?: (tag: TagRead) => boolean): void {
    const resultsByKey = Object.fromEntries(
      Object.entries(this.stateSubject.value.resultsByKey).map(([key, tags]) => [key, predicate ? tags.filter(predicate) : tags])
    );
    const activeKey = serializeQuery(this.stateSubject.value.activeQuery ?? undefined);
    const activeResults = resultsByKey[activeKey] ?? [];

    this.patchState({
      resultsByKey,
      tags: predicate ? activeResults : this.stateSubject.value.tags
    });
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
