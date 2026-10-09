import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { UserStore } from './user.store';
import { API_BASE_URL } from './web/api.config';
import { StorageSetupDialogComponent } from '../components/admin/storage-setup-dialog.component';

@Injectable({providedIn: 'root'})
export class StorageSetupService {
  private readonly users = inject(UserStore);
  private readonly http = inject(HttpClient);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly base = inject(API_BASE_URL);
  private readonly url = toSignal(this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map(event => event.urlAfterRedirects),
  ), {initialValue: this.router.url});
  private requestGeneration = 0;
  private checkedUser: string | null = null;
  private dialogRef: MatDialogRef<StorageSetupDialogComponent> | null = null;

  constructor() {
    effect(() => {
      const user = this.users.currentUser();
      const url = this.url();
      if (!user?.is_admin) {
        this.requestGeneration++;
        this.checkedUser = null;
        this.dialogRef?.close(); this.dialogRef = null;
        return;
      }
      // First-time credential setup lives on the login page; prompt afterward.
      if (url.startsWith('/login') || this.checkedUser === user.id) return;
      this.dialogRef?.close(); this.dialogRef = null;
      const generation = ++this.requestGeneration;
      this.checkedUser = user.id;
      this.http.get<{root: string; folder_configured: boolean; migration: {state: string} | null}>(`${this.base}/api/v1/admin/storage`)
        .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: status => {
            if (generation !== this.requestGeneration || this.url().startsWith('/login')) return;
            if (this.users.currentUser()?.id !== user.id || !this.users.currentUser()?.is_admin || status.folder_configured) return;
            if (['copying', 'verifying', 'cleanup'].includes(status.migration?.state ?? '')) return;
            this.dialogRef = this.dialog.open(StorageSetupDialogComponent, {
              data: {root: status.root}, width: '560px', maxWidth: '95vw',
            });
            this.dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
              this.dialogRef = null;
              if (result === 'settings') void this.router.navigate(['/admin'], {fragment: 'storage'});
            });
          },
          error: () => { if (generation === this.requestGeneration && this.checkedUser === user.id) this.checkedUser = null; },
        });
    });
  }
}
