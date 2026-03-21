import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, catchError, distinctUntilChanged, finalize, map, Observable, tap, throwError } from 'rxjs';

import { UserRead, UserUpdateDto } from '../models/api';
import { AuthService } from './auth.service';
import { beginRequest, completeRequest, createRequestStatus, failRequest, type RequestStatus } from './store.utils';
import { UsersClientService } from './web/users-client.service';

export interface UsersState {
  profile: UserRead | null;
  request: RequestStatus;
  updating: boolean;
}

const initialUsersState = (): UsersState => ({
  profile: null,
  request: createRequestStatus(),
  updating: false
});

@Injectable({
  providedIn: 'root'
})
export class UsersService {
  private readonly usersClient = inject(UsersClientService);
  private readonly authService = inject(AuthService);
  private readonly stateSubject = new BehaviorSubject<UsersState>(initialUsersState());

  readonly state$ = this.stateSubject.asObservable();
  readonly profile$ = this.state$.pipe(
    map((state) => state.profile),
    distinctUntilChanged()
  );
  readonly loading$ = this.state$.pipe(
    map((state) => state.request.loading || state.updating),
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

  constructor() {
    this.authService.user$.subscribe((user) => {
      if (!user) {
        this.stateSubject.next(initialUsersState());
        return;
      }

      this.patchState({
        profile: user
      });
    });
  }

  get snapshot(): UsersState {
    return this.stateSubject.value;
  }

  loadMe(): Observable<UserRead> {
    this.patchState({
      request: beginRequest(this.stateSubject.value.request)
    });

    return this.usersClient.getMe().pipe(
      tap((profile) => {
        this.patchState({
          profile,
          request: completeRequest(this.stateSubject.value.request)
        });
        this.authService.setAuthenticatedUser(profile);
      }),
      catchError((error) => {
        this.patchState({
          request: failRequest(this.stateSubject.value.request, error)
        });
        return throwError(() => error);
      })
    );
  }

  refreshMe(): Observable<UserRead> {
    return this.loadMe();
  }

  updateMe(body: UserUpdateDto): Observable<UserRead> {
    this.patchState({
      updating: true,
      request: {
        ...this.stateSubject.value.request,
        error: null
      }
    });

    return this.usersClient.updateMe(body).pipe(
      tap((profile) => {
        this.patchState({
          profile,
          updating: false,
          request: completeRequest(this.stateSubject.value.request)
        });
        this.authService.setAuthenticatedUser(profile);
      }),
      catchError((error) => {
        this.patchState({
          updating: false,
          request: failRequest(this.stateSubject.value.request, error)
        });
        return throwError(() => error);
      }),
      finalize(() => {
        if (this.stateSubject.value.updating) {
          this.patchState({
            updating: false
          });
        }
      })
    );
  }

  private patchState(patch: Partial<UsersState>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch
    });
  }
}
