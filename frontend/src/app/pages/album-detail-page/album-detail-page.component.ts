import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map, switchMap } from 'rxjs';

import { MediaRead } from '../../models/api';
import { AlbumFormDialogComponent, AlbumFormDialogValue } from '../../components/album-form-dialog/album-form-dialog.component';
import { AppSidebarComponent } from '../../components/app-sidebar/app-sidebar.component';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { GalleryMediaCardComponent } from '../../components/gallery-media-card/gallery-media-card.component';
import { GalleryNavbarComponent } from '../../components/gallery-search/gallery-navbar/gallery-navbar.component';
import { GallerySearchState } from '../../components/gallery-search/gallery-search.models';
import { buildGalleryListQuery, createDefaultGallerySearchFilters } from '../../components/gallery-search/gallery-search.utils';
import { GalleryViewerComponent } from '../../components/gallery-viewer/gallery-viewer.component';
import { SelectionToolbarComponent } from '../../components/selection-toolbar/selection-toolbar.component';
import { AlbumsService } from '../../services/albums.service';
import { MediaService } from '../../services/media.service';

const LOAD_MORE_THRESHOLD_PX = 640;

@Component({
  selector: 'app-album-detail-page',
  imports: [
    AsyncPipe,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    RouterLink,
    AppSidebarComponent,
    GalleryMediaCardComponent,
    GalleryNavbarComponent,
    GalleryViewerComponent,
    SelectionToolbarComponent
  ],
  templateUrl: './album-detail-page.component.html',
  styleUrl: './album-detail-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AlbumDetailPageComponent {
  private readonly albumsService = inject(AlbumsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mediaService = inject(MediaService);

  readonly album$ = this.albumsService.selectedAlbum$;
  readonly media$ = this.mediaService.items$;
  readonly loading$ = this.mediaService.loading$;
  readonly error$ = this.mediaService.error$;

  selectedMedia: MediaRead | null = null;
  selectedMediaIds = new Set<string>();
  searchState: GallerySearchState = {
    searchText: '',
    filters: createDefaultGallerySearchFilters()
  };
  private albumId = '';

  constructor() {
    this.route.paramMap
      .pipe(
        map((params) => params.get('albumId') ?? ''),
        switchMap((albumId) => {
          this.albumId = albumId;
          this.selectedMedia = null;
          this.clearSelection();
          this.searchState = {
            searchText: '',
            filters: createDefaultGallerySearchFilters()
          };
          return this.albumsService.loadAlbum(albumId);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (album) => {
          this.loadMedia();
        },
        error: () => undefined
      });
  }

  reload(): void {
    if (!this.albumId) {
      return;
    }

    this.albumsService.loadAlbum(this.albumId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadMedia();
        },
        error: () => undefined
      });
  }

  applySearch(searchState: GallerySearchState): void {
    this.searchState = {
      searchText: searchState.searchText,
      filters: {
        ...searchState.filters,
        album_id: null
      }
    };
    this.loadMedia();
  }

  renameAlbum(currentName: string, currentDescription: string | null): void {
    this.dialog.open(AlbumFormDialogComponent, {
      width: '420px',
      maxWidth: 'calc(100vw - 2rem)',
      data: {
        title: 'Edit album',
        confirmLabel: 'Save',
        initialName: currentName,
        initialDescription: currentDescription
      }
    }).afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value: AlbumFormDialogValue | undefined) => {
        if (!value || !this.albumId) {
          return;
        }

        if (value.name === currentName && value.description === (currentDescription ?? null)) {
          return;
        }

        this.albumsService.updateAlbum(this.albumId, value)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.snackBar.open('Album renamed.', 'Close', { duration: 2500 });
            },
            error: () => {
              this.snackBar.open('Could not rename album. Please try again.', 'Close', { duration: 3000 });
            }
          });
      });
  }

  deleteAlbum(name: string): void {
    if (!this.albumId) {
      return;
    }

    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      maxWidth: 'calc(100vw - 2rem)',
      data: {
        title: 'Delete album',
        message: `Delete "${name}"? This will remove the album, but it will not delete the images inside it.`,
        confirmLabel: 'Delete',
        confirmButtonColor: 'warn'
      }
    }).afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed: boolean | undefined) => {
        if (!confirmed) {
          return;
        }

        this.albumsService.deleteAlbum(this.albumId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.snackBar.open('Album deleted.', 'Close', { duration: 2500 });
              void this.router.navigate(['/albums']);
            },
            error: () => {
              this.snackBar.open('Could not delete album. Please try again.', 'Close', { duration: 3000 });
            }
          });
      });
  }

  openMedia(media: MediaRead): void {
    if (this.selectionMode) {
      this.toggleSelection(media);
      return;
    }

    this.selectedMedia = media;
  }

  closeMedia(): void {
    this.selectedMedia = null;
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || this.selectedMedia !== null || isEditableTarget(event.target)) {
      return;
    }

    event.preventDefault();

    if (this.selectionMode) {
      this.clearSelection();
      return;
    }

    void this.router.navigate(['/albums']);
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    const root = document.documentElement;
    const remaining = root.scrollHeight - (window.scrollY + window.innerHeight);
    if (remaining > LOAD_MORE_THRESHOLD_PX) {
      return;
    }

    this.mediaService.loadNextPage().subscribe({ error: () => undefined });
  }

  toggleSelection(media: MediaRead): void {
    const next = new Set(this.selectedMediaIds);

    if (next.has(media.id)) {
      next.delete(media.id);
    } else {
      next.add(media.id);
    }

    this.selectedMediaIds = next;

    if (this.selectionMode) {
      this.selectedMedia = null;
    }
  }

  clearSelection(): void {
    this.selectedMediaIds = new Set<string>();
  }

  removeSelectedFromAlbum(): void {
    if (!this.albumId || this.selectedMediaIds.size === 0) {
      return;
    }

    const mediaIds = Array.from(this.selectedMediaIds);
    this.selectedMedia = null;

    this.albumsService.removeMedia(this.albumId, { media_ids: mediaIds })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.clearSelection();
          this.reload();
          this.snackBar.open('Removed selected images from the album.', 'Close', { duration: 2500 });
        },
        error: () => {
          this.snackBar.open('Could not remove the selected images. Please try again.', 'Close', { duration: 3000 });
        }
      });
  }

  isSelected(mediaId: string): boolean {
    return this.selectedMediaIds.has(mediaId);
  }

  get selectionMode(): boolean {
    return this.selectedMediaIds.size > 0;
  }

  get selectedCount(): number {
    return this.selectedMediaIds.size;
  }

  private loadMedia(): void {
    if (!this.albumId) {
      return;
    }

    const query = {
      ...buildGalleryListQuery(this.searchState.searchText, this.searchState.filters),
      album_id: this.albumId,
      page_size: 120
    };
    this.mediaService.loadSearchPage(query).subscribe({ error: () => undefined });
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}
