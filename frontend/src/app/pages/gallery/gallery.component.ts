import { Component, DestroyRef, computed, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MediaBrowserComponent } from '../../components/media-browser/media-browser.component';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { GalleryStore } from '../../services/gallery.store';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { AuthStore } from '../../services/web/auth.store';
import { MediaListState } from '../../models/media';
import { buildTodayStoriesParams } from '../../utils/today-stories.utils';

@Component({
  selector: 'zukan-gallery',
  imports: [LayoutComponent, MediaBrowserComponent],
  templateUrl: './gallery.component.html',
  styleUrl: './gallery.component.scss',
})
export class GalleryComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly authStore = inject(AuthStore);
  readonly galleryStore = inject(GalleryStore);
  private readonly searchService = inject(NavbarSearchService);
  readonly storyParams = computed(() => buildTodayStoriesParams({
    ...this.searchService.appliedParams(),
    state: MediaListState.ACTIVE,
  }));

  constructor() {
    effect(() => {
      if (!this.authStore.isAuthenticated()) {
        return;
      }

      const params = {
        ...this.searchService.appliedParams(),
        state: MediaListState.ACTIVE,
      };
      this.galleryStore.setParams(params);
      this.galleryStore.loadInitial().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    });
  }
}
