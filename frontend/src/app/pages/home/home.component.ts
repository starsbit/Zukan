import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, catchError } from 'rxjs';
import { MediaBrowserComponent } from '../../components/media-browser/media-browser.component';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { GalleryStore } from '../../services/gallery.store';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { MediaListState, MediaVisibility } from '../../models/media';

@Component({
  selector: 'zukan-home',
  imports: [LayoutComponent, MediaBrowserComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  private readonly destroyRef = inject(DestroyRef);
  readonly galleryStore = inject(GalleryStore);
  private readonly searchService = inject(NavbarSearchService);

  constructor() {
    effect(() => {
      const params = {
        ...this.searchService.appliedParams(),
        state: MediaListState.ACTIVE,
        visibility: MediaVisibility.PUBLIC,
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
  }
}
