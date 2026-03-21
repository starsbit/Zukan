import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSidenavModule } from '@angular/material/sidenav';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';

import { MediaRead } from '../../models/api';
import { GalleryNavbarComponent } from '../../components/gallery-search/gallery-navbar/gallery-navbar.component';
import { GallerySearchState } from '../../components/gallery-search/gallery-search.models';
import { buildGalleryListQuery, createDefaultGallerySearchFilters } from '../../components/gallery-search/gallery-search.utils';
import { MediaService } from '../../services/media.service';
import { GalleryMediaCardComponent } from '../../components/gallery-media-card/gallery-media-card.component';
import { GalleryViewerComponent } from '../../components/gallery-viewer/gallery-viewer.component';
import { GalleryUploadDialogComponent } from '../../components/gallery-upload-dialog/gallery-upload-dialog.component';
import { GalleryUploadStatusIslandComponent } from '../../components/gallery-upload-status-island/gallery-upload-status-island.component';
import { MediaUploadService } from '../../services/media-upload.service';

@Component({
  selector: 'app-gallery-page',
  imports: [
    AsyncPipe,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatSidenavModule,
    RouterLink,
    RouterLinkActive,
    GalleryMediaCardComponent,
    GalleryNavbarComponent,
    GalleryViewerComponent,
    GalleryUploadStatusIslandComponent
  ],
  templateUrl: './gallery-page.component.html',
  styleUrl: './gallery-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly mediaService = inject(MediaService);
  private readonly mediaUploadService = inject(MediaUploadService);

  readonly items$ = this.mediaService.items$;
  readonly loading$ = this.mediaService.requestLoading$;
  readonly loaded$ = this.mediaService.loaded$;
  readonly error$ = this.mediaService.error$;
  readonly mutationPending$ = this.mediaService.mutationPending$;

  selectedMedia: MediaRead | null = null;
  dragActive = false;
  isTrashView = false;
  selectedMediaIds = new Set<string>();
  private dragDepth = 0;
  searchState: GallerySearchState = {
    searchText: '',
    filters: createDefaultGallerySearchFilters()
  };
  private activeQuery = buildGalleryListQuery(this.searchState.searchText, this.searchState.filters);

  constructor() {
    this.route.data
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data) => {
        this.isTrashView = data['state'] === 'trashed';
        this.selectedMedia = null;
        this.clearSelection();
        this.activeQuery = this.buildQueryForCurrentView();
        this.loadMedia(this.activeQuery);
      });

    this.mediaUploadService.refreshRequested$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.reload();
      });
  }

  reload(): void {
    this.loadMedia(this.activeQuery);
  }

  applySearch(searchState: GallerySearchState): void {
    this.searchState = searchState;
    this.activeQuery = this.buildQueryForCurrentView();
    this.clearSelection();
    this.loadMedia(this.activeQuery);
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

  openUploadDialog(): void {
    this.dialog.open(GalleryUploadDialogComponent, {
      width: '720px',
      maxWidth: 'calc(100vw - 1.5rem)',
      panelClass: 'gallery-upload-dialog-panel'
    });
  }

  onDragEnter(event: DragEvent): void {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    this.dragDepth += 1;
    this.dragActive = true;
  }

  onDragOver(event: DragEvent): void {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    this.dragActive = true;
  }

  onDragLeave(event: DragEvent): void {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);

    if (this.dragDepth === 0) {
      this.dragActive = false;
    }
  }

  onDrop(event: DragEvent): void {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    this.dragDepth = 0;
    this.dragActive = false;
    this.mediaUploadService.startUpload(Array.from(event.dataTransfer?.files ?? []));
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

  isSelected(mediaId: string): boolean {
    return this.selectedMediaIds.has(mediaId);
  }

  deleteSelected(): void {
    if (this.selectedMediaIds.size === 0) {
      return;
    }

    this.selectedMedia = null;
    this.mediaService.batchUpdateMedia({
      media_ids: Array.from(this.selectedMediaIds),
      deleted: true
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.clearSelection();
        },
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }

  restoreSelected(): void {
    if (this.selectedMediaIds.size === 0) {
      return;
    }

    this.selectedMedia = null;
    this.mediaService.restoreMediaBatch(Array.from(this.selectedMediaIds))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.clearSelection();
        },
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }

  restoreMedia(media: MediaRead): void {
    this.mediaService.restoreMedia(media.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (this.selectedMedia?.id === media.id) {
            this.selectedMedia = null;
          }

          if (this.isSelected(media.id)) {
            this.toggleSelection(media);
          }
        },
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }

  emptyTrash(): void {
    this.selectedMedia = null;
    this.mediaService.emptyTrash()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.clearSelection();
        },
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }

  get selectionMode(): boolean {
    return this.selectedMediaIds.size > 0;
  }

  get selectedCount(): number {
    return this.selectedMediaIds.size;
  }

  private loadMedia(query = this.activeQuery): void {
    this.mediaService.loadPage(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }

  private buildQueryForCurrentView() {
    const query = buildGalleryListQuery(this.searchState.searchText, this.searchState.filters);

    return this.isTrashView ? { ...query, state: 'trashed' as const } : query;
  }
}

function containsFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
