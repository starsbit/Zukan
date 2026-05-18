import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { MediaInspectorDialogComponent } from '../../components/media-browser/media-inspector-dialog/media-inspector-dialog.component';
import { MetadataFilterSelection } from '../../components/shared/metadata-filter-chip/metadata-filter-chip.component';
import { MediaRead } from '../../models/media';
import { GalleryStore } from '../../services/gallery.store';
import { MediaInspectionContextService } from '../../services/media-inspection-context.service';
import { MediaService } from '../../services/media.service';
import { NavbarSearchService } from '../../services/navbar-search.service';

@Component({
  selector: 'zukan-media-inspector-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MediaInspectorDialogComponent,
  ],
  templateUrl: './media-inspector-page.component.html',
  styleUrl: './media-inspector-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaInspectorPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly location = inject(Location);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly mediaService = inject(MediaService);
  private readonly galleryStore = inject(GalleryStore);
  private readonly searchService = inject(NavbarSearchService);
  readonly inspectionContext = inject(MediaInspectionContextService);

  readonly activeMediaId = signal<string | null>(null);
  readonly items = signal<MediaRead[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const mediaId = params.get('mediaId');
        this.activeMediaId.set(mediaId);
        this.loadItemsFor(mediaId);
      });
  }

  onActiveMediaChanged(mediaId: string): void {
    void this.router.navigate(['/media', mediaId]);
  }

  goToGallery(): void {
    void this.router.navigate(['/gallery']);
  }

  goBack(): void {
    this.location.back();
  }

  onMediaUpdated(media: MediaRead): void {
    this.inspectionContext.patchItem(media);
    this.galleryStore.patchItem(media);
  }

  onMetadataFilterSelected(selection: MetadataFilterSelection): void {
    this.searchService.suppressNextUrlSync();
    this.searchService.addMetadataFilter(selection.type, selection.value);

    const originPath = (this.inspectionContext.originUrl() ?? '/gallery').split('?')[0] || '/gallery';
    void this.router.navigate([originPath], {
      queryParams: compactQueryParams(this.searchService.toQueryParamsWithClears()),
    });
  }

  private loadItemsFor(mediaId: string | null): void {
    this.error.set('');
    if (!mediaId) {
      this.items.set([]);
      this.loading.set(false);
      this.error.set('Media not found.');
      return;
    }

    const contextItems = this.inspectionContext.items();
    if (contextItems.some((item) => item.id === mediaId)) {
      this.items.set(contextItems);
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.items.set([]);
    this.mediaService
      .get(mediaId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => {
          this.loading.set(false);
          this.error.set('Unable to load this media.');
          return EMPTY;
        }),
      )
      .subscribe((media) => {
        if (this.activeMediaId() !== mediaId) {
          return;
        }
        this.items.set([media]);
        this.loading.set(false);
      });
  }

}

function compactQueryParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== null && value !== undefined),
  );
}
