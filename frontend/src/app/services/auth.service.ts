import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { finalize, map, switchMap, tap } from 'rxjs/operators';
import { AuthClientService } from './web/auth-client.service';
import { UsersClientService } from './web/users-client.service';
import { AdminClientService } from './web/admin-client.service';
import { AuthStore } from './web/auth.store';
import { UserStore } from './user.store';
import { UploadTrackerService } from './upload-tracker.service';
import { UserSelfRead } from '../models/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly authClient = inject(AuthClientService);
  private readonly usersClient = inject(UsersClientService);
  private readonly adminClient = inject(AdminClientService);
  private readonly authStore = inject(AuthStore);
  private readonly userStore = inject(UserStore);
  private readonly uploadTracker = inject(UploadTrackerService);
  private readonly router = inject(Router);

  login(username: string, password: string, rememberMe: boolean): Observable<void> {
    return this.authClient.login({ username, password, remember_me: rememberMe }).pipe(
      tap(tokens => this.authStore.setTokens(tokens, rememberMe)),
      switchMap(() => this.usersClient.getMe()),
      tap(user => {
        this.uploadTracker.reset();
        this.userStore.set(user);
      }),
      map(() => void 0),
    );
  }

  register(username: string, email: string, password: string): Observable<UserSelfRead> {
    return this.authClient.register({ username, email, password });
  }

  logout(): Observable<void> {
    const refreshToken = this.authStore.getRefreshToken();
    const cleanup = () => {
      this.uploadTracker.reset();
      this.authStore.clear();
      this.userStore.clear();
    };
    if (!refreshToken) {
      cleanup();
      this.router.navigate(['/login']);
      return of(void 0);
    }
    return this.authClient.logout({ refresh_token: refreshToken }).pipe(
      finalize(() => {
        cleanup();
        this.router.navigate(['/login']);
      }),
      map(() => void 0),
    );
  }

  /**
   * First-time setup: registers a new admin account, promotes it via the admin API,
   * then deletes the default admin:admin user. Logs in as the new admin on completion.
   *
   * Requires that the default admin:admin credentials still work.
   */
  setupAdmin(username: string, email: string, password: string): Observable<void> {
    let newUserId = '';
    let defaultAdminId = '';

    return this.authClient.register({ username, email, password }).pipe(
      tap(newUser => { newUserId = newUser.id; }),
      switchMap(() => this.authClient.login({ username: 'admin', password: 'admin', remember_me: false })),
      tap(tokens => this.authStore.setTokens(tokens, false)),
      switchMap(() => this.usersClient.getMe()),
      tap(adminUser => { defaultAdminId = adminUser.id; }),
      switchMap(() => this.adminClient.updateUser(newUserId, { is_admin: true })),
      switchMap(() => this.adminClient.deleteUser(defaultAdminId).pipe(map(() => null))),
      switchMap(() => this.authClient.login({ username, password, remember_me: true })),
      tap(tokens => this.authStore.setTokens(tokens, true)),
      switchMap(() => this.usersClient.getMe()),
      tap(user => {
        this.uploadTracker.reset();
        this.userStore.set(user);
      }),
      map((): void => void 0),
    ) as Observable<void>;
  }
}
