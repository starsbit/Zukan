import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { finalize, map, switchMap, tap } from 'rxjs/operators';
import { AuthClientService } from './web/auth-client.service';
import { UsersClientService } from './web/users-client.service';
import { AuthStore } from './web/auth.store';
import { UserStore } from './user.store';
import { UploadTrackerService } from './upload-tracker.service';
import { TokenResponse } from '../models/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly client = inject(AuthClientService);
  private readonly users = inject(UsersClientService);
  private readonly tokens = inject(AuthStore);
  private readonly owner = inject(UserStore);
  private readonly uploads = inject(UploadTrackerService);
  private readonly router = inject(Router);
  configuration() {
    return this.client.configuration();
  }
  startSso(returnUrl: string) {
    this.client.startSso(returnUrl);
  }
  private establish(result: Observable<TokenResponse>, remember: boolean): Observable<void> {
    return result.pipe(
      tap((tokens) => this.tokens.setTokens(tokens, remember)),
      switchMap(() => this.users.getMe()),
      tap((owner) => {
        this.uploads.reset();
        this.owner.set(owner);
      }),
      map(() => void 0),
    );
  }
  login(username: string, password: string, remember: boolean) {
    return this.establish(
      this.client.login({ username, password, remember_me: remember }),
      remember,
    );
  }
  setup(username: string, password: string, setupToken: string) {
    return this.establish(this.client.setup(username, password, setupToken), false);
  }
  exchange(code: string) {
    return this.establish(this.client.exchange(code), false);
  }
  logout(): Observable<void> {
    const refresh = this.tokens.getRefreshToken();
    return (refresh ? this.client.logout({ refresh_token: refresh }) : of(void 0)).pipe(
      finalize(() => {
        this.uploads.reset();
        this.tokens.clear();
        this.owner.clear();
        this.router.navigate(['/login']);
      }),
    );
  }
}
