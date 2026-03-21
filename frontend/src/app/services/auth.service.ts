import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, catchError, distinctUntilChanged, finalize, map, Observable, of, switchMap, tap, throwError } from 'rxjs';

import { LogoutRequestDto, RefreshRequestDto, UserLoginDto, UserRead, UserRegisterDto } from '../models/api';
import { AuthClientService } from './web/auth-client.service';
import { ClientAuthStore } from './web/auth.store';
import { UsersClientService } from './web/users-client.service';

export interface AuthState {
  user: UserRead | null;
  status: 'anonymous' | 'authenticated';
  initialized: boolean;
  loginPending: boolean;
  refreshPending: boolean;
  logoutPending: boolean;
  error: unknown | null;
}

const initialAuthState = (): AuthState => ({
  user: null,
  status: 'anonymous',
  initialized: false,
  loginPending: false,
  refreshPending: false,
  logoutPending: false,
  error: null
});

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly authClient = inject(AuthClientService);
  private readonly authStore = inject(ClientAuthStore);
  private readonly usersClient = inject(UsersClientService);
  private readonly stateSubject = new BehaviorSubject<AuthState>(initialAuthState());

  readonly state$ = this.stateSubject.asObservable();
  readonly user$ = this.state$.pipe(
    map((state) => state.user),
    distinctUntilChanged()
  );
  readonly isAuthenticated$ = this.state$.pipe(
    map((state) => state.status === 'authenticated'),
    distinctUntilChanged()
  );
  readonly loading$ = this.state$.pipe(
    map((state) => state.loginPending || state.refreshPending || state.logoutPending),
    distinctUntilChanged()
  );
  readonly error$ = this.state$.pipe(
    map((state) => state.error),
    distinctUntilChanged()
  );

  get snapshot(): AuthState {
    return this.stateSubject.value;
  }

  initializeSession(): Observable<UserRead | null> {
    const refreshToken = this.authStore.getRefreshToken();
    if (!refreshToken) {
      this.clearSessionState();
      return of(null);
    }

    return this.refreshSession({ refresh_token: refreshToken }).pipe(
      catchError(() => of(null))
    );
  }

  loadCurrentUser(): Observable<UserRead> {
    this.patchState({
      error: null
    });

    return this.usersClient.getMe().pipe(
      tap((user) => this.setAuthenticatedUser(user)),
      catchError((error) => {
        this.clearSessionState(error);
        return throwError(() => error);
      })
    );
  }

  register(body: UserRegisterDto): Observable<UserRead> {
    this.patchState({
      loginPending: true,
      error: null
    });

    return this.authClient.register(body).pipe(
      switchMap(() => this.login({
        username: body.username,
        password: body.password
      })),
      catchError((error) => {
        this.patchState({
          error
        });
        return throwError(() => error);
      }),
      finalize(() => {
        this.patchState({
          loginPending: false
        });
      })
    );
  }

  login(body: UserLoginDto): Observable<UserRead> {
    this.patchState({
      loginPending: true,
      error: null
    });

    return this.authClient.login(body).pipe(
      switchMap(() => this.usersClient.getMe()),
      tap((user) => this.setAuthenticatedUser(user)),
      catchError((error) => {
        this.patchState({
          error
        });
        return throwError(() => error);
      }),
      finalize(() => {
        this.patchState({
          loginPending: false
        });
      })
    );
  }

  refreshSession(body?: RefreshRequestDto): Observable<UserRead> {
    this.patchState({
      refreshPending: true,
      error: null
    });

    return this.authClient.refresh(body).pipe(
      switchMap(() => this.usersClient.getMe()),
      tap((user) => this.setAuthenticatedUser(user)),
      catchError((error) => {
        this.clearSessionState(error);
        return throwError(() => error);
      }),
      finalize(() => {
        this.patchState({
          refreshPending: false
        });
      })
    );
  }

  logout(body?: LogoutRequestDto): Observable<void> {
    this.patchState({
      logoutPending: true,
      error: null
    });

    return this.authClient.logout(body).pipe(
      tap(() => this.clearSessionState()),
      catchError((error) => {
        this.patchState({
          error
        });
        return throwError(() => error);
      }),
      finalize(() => {
        this.patchState({
          logoutPending: false
        });
      })
    );
  }

  setAuthenticatedUser(user: UserRead | null): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      user,
      status: user ? 'authenticated' : 'anonymous',
      initialized: true,
      error: null
    });
  }

  clearSessionState(error: unknown | null = null): void {
    this.stateSubject.next({
      ...initialAuthState(),
      initialized: true,
      error
    });
  }

  private patchState(patch: Partial<AuthState>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch
    });
  }
}
