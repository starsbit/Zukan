import { inject, Injectable } from '@angular/core';
import { catchError, map, of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from './web/auth.store';
import { UserStore } from './user.store';

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly authStore = inject(AuthStore);
  private readonly userStore = inject(UserStore);

  restore(): Promise<void> {
    if (!this.authStore.isAuthenticated()) {
      return Promise.resolve();
    }

    return firstValueFrom(
      this.userStore.load().pipe(
        map(() => void 0),
        catchError(() => {
          this.authStore.clear();
          this.userStore.clear();
          return of(void 0);
        }),
      ),
    );
  }
}
