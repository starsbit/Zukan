import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Subscription, interval, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { API_BASE_URL } from './web/api.config';

export type UpdateStatus = 'idle' | 'updating' | 'restarting' | 'done';

@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  readonly status = signal<UpdateStatus>('idle');

  private pollSub: Subscription | null = null;
  private serverWasDown = false;

  startUpdate(): void {
    this.serverWasDown = false;
    this.status.set('updating');
    this.stopPolling();
    this.beginPolling();
  }

  dismiss(): void {
    this.stopPolling();
    this.status.set('idle');
  }

  private beginPolling(): void {
    this.pollSub = interval(3000).pipe(
      switchMap(() =>
        this.http.get(`${this.base}/api/v1/admin/health`, { observe: 'response' }).pipe(
          catchError(() => of(null)),
        ),
      ),
    ).subscribe((response) => {
      if (response === null) {
        this.serverWasDown = true;
        this.status.set('restarting');
      } else if (this.serverWasDown) {
        this.stopPolling();
        this.status.set('done');
      }
    });
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }
}
