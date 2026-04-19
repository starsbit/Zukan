import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EMPTY, catchError, finalize, of, switchMap } from 'rxjs';
import { AlbumAccessEntryRead, AlbumAccessListResponse } from '../../../models/albums';
import { AlbumStore } from '../../../services/album.store';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';

export interface AlbumAccessDialogData {
  albumId: string;
  albumName: string;
}

@Component({
  selector: 'zukan-album-access-dialog',
  imports: [
    DatePipe,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './album-access-dialog.component.html',
  styleUrl: './album-access-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumAccessDialogComponent {
  private readonly albumStore = inject(AlbumStore);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly data = inject<AlbumAccessDialogData>(MAT_DIALOG_DATA);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly owner = signal<AlbumAccessListResponse['owner'] | null>(null);
  readonly entries = signal<AlbumAccessEntryRead[]>([]);
  readonly revokingUserIds = signal<Set<string>>(new Set());
  readonly hasEntries = computed(() => this.entries().length > 0);

  constructor() {
    this.reload();
  }

  revoke(entry: AlbumAccessEntryRead): void {
    if (this.isRevoking(entry.user_id)) {
      return;
    }

    this.confirmDialog.open({
      title: 'Revoke album access?',
      message: `Remove ${entry.username} from "${this.data.albumName}"?`,
      confirmLabel: 'Revoke access',
      tone: 'warn',
    }).pipe(
      switchMap((confirmed) => {
        if (!confirmed) {
          return EMPTY;
        }

        this.actionError.set(null);
        this.setRevoking(entry.user_id, true);
        return this.albumStore.revokeShare(this.data.albumId, entry.user_id).pipe(
          finalize(() => this.setRevoking(entry.user_id, false)),
          catchError((error: { error?: { detail?: string } }) => {
            this.actionError.set(error.error?.detail ?? 'Unable to revoke album access.');
            return EMPTY;
          }),
        );
      }),
    ).subscribe(() => {
      this.entries.update((entries) => entries.filter((candidate) => candidate.user_id !== entry.user_id));
      this.snackBar.open(`Removed ${entry.username} from the album.`, 'Close', { duration: 4000 });
    });
  }

  isRevoking(userId: string): boolean {
    return this.revokingUserIds().has(userId);
  }

  protected reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.actionError.set(null);
    this.albumStore.listShares(this.data.albumId).pipe(
      finalize(() => this.loading.set(false)),
      catchError((error: { error?: { detail?: string } }) => {
        this.owner.set(null);
        this.entries.set([]);
        this.loadError.set(error.error?.detail ?? 'Unable to load album access.');
        return of(null);
      }),
    ).subscribe((response) => {
      if (!response) {
        return;
      }

      this.owner.set(response.owner);
      this.entries.set(response.entries);
    });
  }

  protected trackEntry(_index: number, entry: AlbumAccessEntryRead): string {
    return entry.user_id;
  }

  private setRevoking(userId: string, active: boolean): void {
    this.revokingUserIds.update((current) => {
      const next = new Set(current);
      if (active) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });
  }
}
