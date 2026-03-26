import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { AlbumRead } from '../../models/api';
import { AlbumCardComponent } from '../../components/album-card/album-card.component';
import { AlbumFormDialogComponent, AlbumFormDialogValue } from '../../components/album-form-dialog/album-form-dialog.component';
import { AppSidebarComponent } from '../../components/app-sidebar/app-sidebar.component';
import { ListStateComponent } from '../../components/list-state/list-state.component';
import { AlbumsService } from '../../services/albums.service';
import { createResponsiveDialogConfig } from '../../utils/dialog-config.utils';

@Component({
  selector: 'app-albums-page',
  imports: [
    AsyncPipe,
    MatButtonModule,
    MatIconModule,
    AlbumCardComponent,
    AppSidebarComponent,
    ListStateComponent
  ],
  templateUrl: './albums-page.component.html',
  styleUrl: './albums-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AlbumsPageComponent {
  private readonly albumsService = inject(AlbumsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  readonly albums$ = this.albumsService.albums$;
  readonly loading$ = this.albumsService.loading$;
  readonly error$ = this.albumsService.error$;

  constructor() {
    this.albumsService.loadAlbums().subscribe({ error: () => undefined });
  }

  createAlbum(): void {
    this.dialog.open(AlbumFormDialogComponent, createResponsiveDialogConfig({
      data: {
        title: 'Create album',
        confirmLabel: 'Create'
      }
    }, '420px')).afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value: AlbumFormDialogValue | undefined) => {
        if (!value) {
          return;
        }

        this.albumsService.createAlbum(value)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (album: AlbumRead) => {
              this.snackBar.open(`Created "${album.name}".`, 'Close', { duration: 2500 });
            },
            error: () => {
              this.snackBar.open('Could not create album. Please try again.', 'Close', { duration: 3000 });
            }
          });
      });
  }

  reload(): void {
    this.albumsService.loadAlbums().subscribe({ error: () => undefined });
  }
}
