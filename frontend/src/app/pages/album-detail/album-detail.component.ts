import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, catchError, map, switchMap, tap } from 'rxjs';
import { AlbumAccessRole } from '../../models/albums';
import { MediaListState, MediaRead } from '../../models/media';
import { MediaBrowserComponent } from '../../components/media-browser/media-browser.component';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { AlbumFormDialogComponent, AlbumFormDialogValue } from '../../components/album/album-form-dialog/album-form-dialog.component';
import { AlbumShareDialogComponent, AlbumShareDialogValue } from '../../components/album/album-share-dialog/album-share-dialog.component';
import {
  AlbumThumbnailDialogComponent,
  AlbumThumbnailDialogValue,
} from '../../components/album/album-thumbnail-dialog/album-thumbnail-dialog.component';
import { AlbumStore } from '../../services/album.store';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { GalleryStore } from '../../services/gallery.store';
import { MediaService } from '../../services/media.service';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { UserStore } from '../../services/user.store';
import { AuthStore } from '../../services/web/auth.store';

@Component({
  selector: 'zukan-album-detail',
  imports: [
    LayoutComponent,
    MediaBrowserComponent,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './album-detail.component.html',
  styleUrl: './album-detail.component.scss',
})
export class AlbumDetailComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly authStore = inject(AuthStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly mediaService = inject(MediaService);
  private readonly searchService = inject(NavbarSearchService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly userStore = inject(UserStore);

  readonly albumStore = inject(AlbumStore);
  readonly galleryStore = inject(GalleryStore);

  private readonly albumIdParam = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('albumId'))),
    { initialValue: this.route.snapshot.paramMap.get('albumId') },
  );
  readonly albumId = computed(() => this.albumIdParam());
  readonly album = this.albumStore.selectedAlbum;
  readonly canEdit = computed(() => {
    const role = this.album()?.access_role;
    return role === AlbumAccessRole.OWNER || role === AlbumAccessRole.EDITOR;
  });
  readonly canDelete = computed(() =>
    this.album()?.access_role === AlbumAccessRole.OWNER || this.userStore.isAdmin(),
  );
  readonly canInvite = computed(() =>
    this.album()?.access_role === AlbumAccessRole.OWNER || this.userStore.isAdmin(),
  );
  readonly accessLabel = computed(() => {
    switch (this.album()?.access_role) {
      case AlbumAccessRole.OWNER:
        return 'Owner';
      case AlbumAccessRole.EDITOR:
        return 'Can edit';
      case AlbumAccessRole.VIEWER:
        return 'View only';
      default:
        return '';
    }
  });
  readonly ownerName = computed(() => this.album()?.owner?.username ?? 'Unknown');
  readonly headerPreviewUrl = signal<string | null>(null);
  readonly headerPreviewLoading = signal(false);

  private headerPreviewRequestId = 0;

  constructor() {
    effect(() => {
      if (!this.authStore.isAuthenticated()) {
        return;
      }

      const albumId = this.albumId();
      if (!albumId) {
        return;
      }

      this.albumStore.get(albumId).pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => {
          void this.router.navigate(['/album']);
          return EMPTY;
        }),
      ).subscribe();

      const params = {
        ...this.searchService.appliedParams(),
        album_id: albumId,
        state: MediaListState.ACTIVE,
      };
      this.galleryStore.setParams(params);
      this.galleryStore.load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
      this.galleryStore.loadTimeline().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    });

    effect(() => {
      if (this.galleryStore.hasMore() && !this.galleryStore.loading()) {
        this.galleryStore.loadMore()
          .pipe(takeUntilDestroyed(this.destroyRef), catchError(() => EMPTY))
          .subscribe();
      }
    });

    effect(() => {
      const album = this.album();
      const previewMediaId = album?.cover_media_id ?? album?.preview_media?.[0]?.id ?? null;
      const requestId = ++this.headerPreviewRequestId;

      this.headerPreviewUrl.set(null);
      this.headerPreviewLoading.set(!!previewMediaId);

      if (!previewMediaId) {
        this.headerPreviewLoading.set(false);
        return;
      }

      this.mediaService.getThumbnailUrl(previewMediaId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (url) => {
            if (requestId !== this.headerPreviewRequestId) {
              return;
            }
            this.headerPreviewUrl.set(url);
            this.headerPreviewLoading.set(false);
          },
          error: () => {
            if (requestId !== this.headerPreviewRequestId) {
              return;
            }
            this.headerPreviewLoading.set(false);
          },
        });
    });
  }

  editAlbum(): void {
    const album = this.album();
    if (!album || !this.canEdit()) {
      return;
    }

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

  deleteAlbum(): void {
    const album = this.album();
    if (!album || !this.canDelete()) {
      return;
    }

    this.confirmDialog.open({
      title: 'Delete album?',
      message: `Delete "${album.name}"? This removes the album, but keeps the media files.`,
      confirmLabel: 'Delete album',
      tone: 'warn',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.albumStore.delete(album.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        void this.router.navigate(['/album']);
      });
    });
  }

  inviteToAlbum(): void {
    const album = this.album();
    if (!album || !this.canInvite()) {
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

  editThumbnail(): void {
    const album = this.album();
    if (!album || !this.canEdit()) {
      return;
    }

    this.dialog.open(AlbumThumbnailDialogComponent, {
      data: {
        albumId: album.id,
        albumName: album.name,
        currentCoverMediaId: album.cover_media_id,
      },
      maxWidth: '920px',
      width: '100%',
    }).afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef),
      switchMap((value: AlbumThumbnailDialogValue | undefined) => {
        if (!value) {
          return EMPTY;
        }

        if (value.file) {
          return this.mediaService.upload([value.file], { album_id: album.id }).pipe(
            map((response) => response.results.find((result) => result.status === 'accepted' && result.id)?.id ?? null),
            switchMap((uploadedMediaId) => {
              if (!uploadedMediaId) {
                this.snackBar.open('Unable to upload the album thumbnail image.', 'Close', { duration: 5000 });
                return EMPTY;
              }

              return this.albumStore.update(album.id, {
                cover_media_id: uploadedMediaId,
                version: album.version,
              }).pipe(
                tap(() => this.refreshAlbumMedia()),
              );
            }),
          );
        }

        return this.albumStore.update(album.id, {
          cover_media_id: value.coverMediaId,
          version: album.version,
        });
      }),
      catchError((error: { error?: { detail?: string } }) => {
        this.snackBar.open(error.error?.detail ?? 'Unable to update the album thumbnail.', 'Close', { duration: 5000 });
        return EMPTY;
      }),
    ).subscribe();
  }

  onFavoriteToggled(media: MediaRead): void {
    this.galleryStore.toggleFavorite(media)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  private refreshAlbumMedia(): void {
    this.galleryStore.load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    this.galleryStore.loadTimeline().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
}
