import { computed, inject, Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { UserRead } from '../models/auth';
import { UsersClientService } from './web/users-client.service';

@Injectable({ providedIn: 'root' })
export class UserStore {
  private readonly client = inject(UsersClientService);

  private readonly _user = signal<UserRead | null>(null);

  readonly currentUser = this._user.asReadonly();
  readonly isAdmin = computed(() => this._user()?.is_admin ?? false);

  load(): Observable<UserRead> {
    return this.client.getMe().pipe(tap(u => this._user.set(u)));
  }

  set(user: UserRead): void {
    this._user.set(user);
  }

  update(patch: Partial<UserRead>): void {
    this._user.update((current) => current ? { ...current, ...patch } : current);
  }

  clear(): void {
    this._user.set(null);
  }
}
