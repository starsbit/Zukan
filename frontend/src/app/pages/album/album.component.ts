import { Component, DestroyRef, computed, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { EMPTY, catchError } from 'rxjs';
import { AlbumRead } from '../../models/albums';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { AlbumCardComponent } from '../../components/album/album-card/album-card.component';
import { AlbumFormDialogComponent, AlbumFormDialogValue } from '../../components/album/album-form-dialog/album-form-dialog.component';
import { AlbumShareDialogComponent, AlbumShareDialogValue } from '../../components/album/album-share-dialog/album-share-dialog.component';
import { AlbumStore } from '../../services/album.store';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { UserStore } from '../../services/user.store';
import { AuthStore } from '../../services/web/auth.store';

@Component({
  selector: 'zukan-album',
  imports: [
    LayoutComponent,
    AlbumCardComponent,
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './album.component.html',
  styleUrl: './album.component.scss',
})
export class AlbumComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly authStore = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly snackBar = inject(MatSnackBar);
  readonly userStore = inject(UserStore);

  readonly albumStore = inject(AlbumStore);
  readonly albums = this.albumStore.items;
  readonly loading = this.albumStore.loading;
  readonly isEmpty = this.albumStore.isEmpty;
  readonly hasAlbums = computed(() => this.albums().length > 0);

  constructor() {
    effect(() => {
      if (!this.authStore.isAuthenticated()) {
        return;
      }

      this.albumStore.load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    });
  }

  createAlbum(): void {
    this.dialog.open(AlbumFormDialogComponent, {
      data: {
        title: 'Create album',
        confirmLabel: 'Create',
      },
      maxWidth: '560px',
      width: '100%',
    }).afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((value: AlbumFormDialogValue | undefined) => {
      if (!value) {
        return;
      }

      this.albumStore.create({
        name: value.name,
        description: value.description,
      }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    });
  }

  editAlbum(album: AlbumRead): void {
    this.dialog.open(AlbumFormDialogComponent, {
      data: {
        title: 'Edit album',
        confirmLabel: 'Save',
        initialName: album.name,
        initialDescription: album.description,
      },
      maxWidth: '560px',
      width: '100%',
    }).afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((value: AlbumFormDialogValue | undefined) => {
      if (!value) {
        return;
      }

      this.albumStore.update(album.id, {
        name: value.name,
        description: value.description,
        version: album.version,
      }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    });
  }

  inviteToAlbum(album: AlbumRead): void {
    if (!this.canInvite(album)) {
      return;
    }

    this.dialog.open(AlbumShareDialogComponent, {
      data: {
        albumName: album.name,
      },
      maxWidth: '560px',
      width: '100%',
    }).afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((value: AlbumShareDialogValue | undefined) => {
      if (!value) {
        return;
      }

      this.albumStore.share(album.id, {
        username: value.username,
        role: value.role,
      }).pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error: { error?: { detail?: string } }) => {
          this.snackBar.open(error.error?.detail ?? 'Unable to send the album invite.', 'Close', { duration: 5000 });
          return EMPTY;
        }),
      ).subscribe((result) => {
        const message = result.status === 'pending'
          ? `Invite sent to ${value.username}.`
          : `Updated ${value.username}'s album access.`;
        this.snackBar.open(message, 'Close', { duration: 4000 });
      });
    });
  }

  deleteAlbum(album: AlbumRead): void {
    this.confirmDialog.open({
      title: 'Delete album?',
      message: `Delete "${album.name}"? This removes the album, but keeps the media files.`,
      confirmLabel: 'Delete album',
      tone: 'warn',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.albumStore.delete(album.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    });
  }

  canEdit(album: AlbumRead): boolean {
    return album.access_role === 'owner' || album.access_role === 'editor';
  }

  canDelete(album: AlbumRead): boolean {
    return album.access_role === 'owner' || this.userStore.isAdmin();
  }

  canInvite(album: AlbumRead): boolean {
    return album.access_role === 'owner' || this.userStore.isAdmin();
  }
}
