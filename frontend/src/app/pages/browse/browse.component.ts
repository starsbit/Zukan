import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MediaBrowserComponent } from '../../components/media-browser/media-browser.component';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { GalleryStore } from '../../services/gallery.store';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { MediaListState, MediaVisibility } from '../../models/media';
import { buildTodayStoriesParams } from '../../utils/today-stories.utils';

@Component({
  selector: 'zukan-browse',
  imports: [LayoutComponent, MediaBrowserComponent],
  templateUrl: './browse.component.html',
  styleUrl: './browse.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrowseComponent {
  private readonly destroyRef = inject(DestroyRef);
  readonly galleryStore = inject(GalleryStore);
  private readonly searchService = inject(NavbarSearchService);
  readonly storyParams = computed(() => buildTodayStoriesParams({
    ...this.searchService.appliedParams(),
    state: MediaListState.ACTIVE,
    visibility: MediaVisibility.PUBLIC,
  }));

  constructor() {
    effect(() => {
      const params = {
        ...this.searchService.appliedParams(),
        state: MediaListState.ACTIVE,
        visibility: MediaVisibility.PUBLIC,
      };
      this.galleryStore.setParams(params);
      this.galleryStore.loadInitial().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    });
  }
}
