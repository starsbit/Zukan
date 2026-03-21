import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, catchError, distinctUntilChanged, finalize, map, Observable, tap, throwError } from 'rxjs';

import {
  AdminStatsResponse,
  AdminUserDetail,
  AdminUserUpdateDto,
  ListAdminUsersQuery,
  TaggingJobQueuedResponse,
  UserListResponse,
  UserRead,
  Uuid
} from '../models/api';
import { AuthService } from './auth.service';
import { beginRequest, completeRequest, createRequestStatus, failRequest, patchItemById, removeItemById, type RequestStatus } from './store.utils';
import { AdminClientService } from './web/admin-client.service';

export class AdminAccessError extends Error {
  constructor() {
    super('Admin access required');
    this.name = 'AdminAccessError';
  }
}

export interface AdminState {
  stats: AdminStatsResponse | null;
  usersPage: UserListResponse | null;
  usersQuery: ListAdminUsersQuery | null;
  selectedUserId: Uuid | null;
  userDetails: Record<Uuid, AdminUserDetail>;
  statsRequest: RequestStatus;
  usersRequest: RequestStatus;
  detailRequest: RequestStatus;
  mutationPending: boolean;
  mutationError: unknown | null;
}

const initialAdminState = (): AdminState => ({
  stats: null,
  usersPage: null,
  usersQuery: null,
  selectedUserId: null,
  userDetails: {},
  statsRequest: createRequestStatus(),
  usersRequest: createRequestStatus(),
  detailRequest: createRequestStatus(),
  mutationPending: false,
  mutationError: null
});

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private readonly authService = inject(AuthService);
  private readonly adminClient = inject(AdminClientService);
  private readonly stateSubject = new BehaviorSubject<AdminState>(initialAdminState());

  readonly state$ = this.stateSubject.asObservable();
  readonly stats$ = this.state$.pipe(
    map((state) => state.stats),
    distinctUntilChanged()
  );
  readonly usersPage$ = this.state$.pipe(
    map((state) => state.usersPage),
    distinctUntilChanged()
  );
  readonly selectedUser$ = this.state$.pipe(
    map((state) => state.selectedUserId ? state.userDetails[state.selectedUserId] ?? null : null),
    distinctUntilChanged()
  );
  readonly loading$ = this.state$.pipe(
    map((state) => state.statsRequest.loading || state.usersRequest.loading || state.detailRequest.loading || state.mutationPending),
    distinctUntilChanged()
  );
  readonly error$ = this.state$.pipe(
    map((state) => state.mutationError ?? state.detailRequest.error ?? state.usersRequest.error ?? state.statsRequest.error),
    distinctUntilChanged()
  );

  get snapshot(): AdminState {
    return this.stateSubject.value;
  }

  getStats(): Observable<AdminStatsResponse> {
    return this.withAdminAccess(() => {
      this.patchState({
        statsRequest: beginRequest(this.stateSubject.value.statsRequest)
      });

      return this.adminClient.getStats().pipe(
        tap((stats) => {
          this.patchState({
            stats,
            statsRequest: completeRequest(this.stateSubject.value.statsRequest)
          });
        }),
        catchError((error) => {
          this.patchState({
            statsRequest: failRequest(this.stateSubject.value.statsRequest, error)
          });
          return throwError(() => error);
        })
      );
    });
  }

  listUsers(query?: ListAdminUsersQuery): Observable<UserListResponse> {
    return this.withAdminAccess(() => {
      this.patchState({
        usersQuery: query ?? null,
        usersRequest: beginRequest(this.stateSubject.value.usersRequest)
      });

      return this.adminClient.listUsers(query).pipe(
        tap((usersPage) => {
          this.patchState({
            usersPage,
            usersQuery: query ?? null,
            usersRequest: completeRequest(this.stateSubject.value.usersRequest)
          });
        }),
        catchError((error) => {
          this.patchState({
            usersRequest: failRequest(this.stateSubject.value.usersRequest, error)
          });
          return throwError(() => error);
        })
      );
    });
  }

  getUserDetail(userId: Uuid): Observable<AdminUserDetail> {
    return this.withAdminAccess(() => {
      this.patchState({
        selectedUserId: userId,
        detailRequest: beginRequest(this.stateSubject.value.detailRequest)
      });

      return this.adminClient.getUserDetail(userId).pipe(
        tap((userDetail) => {
          this.patchState({
            userDetails: {
              ...this.stateSubject.value.userDetails,
              [userId]: userDetail
            },
            selectedUserId: userId,
            detailRequest: completeRequest(this.stateSubject.value.detailRequest)
          });
        }),
        catchError((error) => {
          this.patchState({
            detailRequest: failRequest(this.stateSubject.value.detailRequest, error)
          });
          return throwError(() => error);
        })
      );
    });
  }

  updateUser(userId: Uuid, body: AdminUserUpdateDto): Observable<UserRead> {
    return this.withAdminAccess(() => {
      this.startMutation();

      return this.adminClient.updateUser(userId, body).pipe(
        tap((user) => {
          const selectedUser = this.stateSubject.value.userDetails[userId];
          this.patchState({
            usersPage: this.stateSubject.value.usersPage
              ? {
                ...this.stateSubject.value.usersPage,
                items: patchItemById(this.stateSubject.value.usersPage.items, userId, user)
              }
              : null,
            userDetails: selectedUser
              ? {
                ...this.stateSubject.value.userDetails,
                [userId]: { ...selectedUser, ...user }
              }
              : this.stateSubject.value.userDetails
          });
          this.finishMutation();
        }),
        catchError((error) => this.failMutation(error)),
        finalize(() => this.ensureMutationSettled())
      );
    });
  }

  deleteUser(userId: Uuid, deleteMedia?: boolean): Observable<void> {
    return this.withAdminAccess(() => {
      this.startMutation();

      return this.adminClient.deleteUser(userId, deleteMedia).pipe(
        tap(() => {
          const userDetails = { ...this.stateSubject.value.userDetails };
          delete userDetails[userId];

          this.patchState({
            usersPage: this.stateSubject.value.usersPage
              ? {
                ...this.stateSubject.value.usersPage,
                items: removeItemById(this.stateSubject.value.usersPage.items, userId),
                total: Math.max(0, this.stateSubject.value.usersPage.total - 1)
              }
              : null,
            userDetails,
            selectedUserId: this.stateSubject.value.selectedUserId === userId ? null : this.stateSubject.value.selectedUserId
          });
          this.finishMutation();
        }),
        tap(() => {
          if (this.stateSubject.value.stats) {
            this.getStats().subscribe();
          }
        }),
        catchError((error) => this.failMutation(error)),
        finalize(() => this.ensureMutationSettled())
      );
    });
  }

  queueUserTaggingJobs(userId: Uuid): Observable<TaggingJobQueuedResponse> {
    return this.withAdminAccess(() => {
      this.startMutation();

      return this.adminClient.queueUserTaggingJobs(userId).pipe(
        tap(() => this.finishMutation()),
        catchError((error) => this.failMutation(error)),
        finalize(() => this.ensureMutationSettled())
      );
    });
  }

  private withAdminAccess<T>(operation: () => Observable<T>): Observable<T> {
    return this.authService.snapshot.user?.is_admin
      ? operation()
      : throwError(() => new AdminAccessError());
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

  private patchState(patch: Partial<AdminState>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch
    });
  }
}
