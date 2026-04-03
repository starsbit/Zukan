import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, catchError } from 'rxjs';
import { MediaBrowserComponent } from '../../components/media-browser/media-browser.component';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { GalleryStore } from '../../services/gallery.store';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { AuthStore } from '../../services/web/auth.store';
import { buildFavoritesParams } from './favorites.params';
import { buildTodayStoriesParams } from '../../utils/today-stories.utils';

@Component({
  selector: 'zukan-favorites',
  imports: [LayoutComponent, MediaBrowserComponent],
  templateUrl: './favorites.component.html',
  styleUrl: './favorites.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FavoritesComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly authStore = inject(AuthStore);
  readonly galleryStore = inject(GalleryStore);
  private readonly searchService = inject(NavbarSearchService);
  readonly storyParams = computed(() =>
    buildTodayStoriesParams(buildFavoritesParams(this.searchService.appliedParams())),
  );

  constructor() {
    effect(() => {
      if (!this.authStore.isAuthenticated()) {
        return;
      }

      const params = buildFavoritesParams(this.searchService.appliedParams());
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
