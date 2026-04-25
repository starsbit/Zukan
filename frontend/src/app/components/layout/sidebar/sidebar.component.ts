import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { UserRead } from '../../../models/auth';
import { NavbarSearchService, SearchQueryParams } from '../../../services/navbar-search.service';
import { UserStore } from '../../../services/user.store';

type NavigationItem = {
  icon: string;
  label: string;
  path: string;
};

type NavigationSection = {
  label: string;
  items: NavigationItem[];
};

@Component({
  selector: 'zukan-sidebar',
  imports: [MatIconModule, MatListModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  private readonly searchService = inject(NavbarSearchService);
  private readonly userStore = inject(UserStore);
  readonly currentUser = this.userStore.currentUser;

  searchQueryParams(): SearchQueryParams {
    return typeof this.searchService.toQueryParams === 'function'
      ? this.searchService.toQueryParams()
      : {};
  }

  storagePercent(user: UserRead): number {
    if (!user.storage_quota_mb) return 0;
    return Math.min(user.storage_used_mb / user.storage_quota_mb * 100, 100);
  }

  formatMb(mb: number): string {
    if (mb >= 1024) {
      const gb = mb / 1024;
      return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
    }
    return `${mb} MB`;
  }

  readonly navigationSections: NavigationSection[] = [
    {
      label: 'Browse',
      items: [
        { icon: 'photo_library', label: 'Gallery', path: '/gallery' },
        { icon: 'travel_explore', label: 'Browse', path: '/browse' },
        { icon: 'hub', label: 'Graph', path: '/graph/characters' },
        { icon: 'favorite', label: 'Favorites', path: '/favorites' },
      ],
    },
    {
      label: 'Library',
      items: [
        { icon: 'collections_bookmark', label: 'Album', path: '/album' },
        { icon: 'sell', label: 'Tags', path: '/tags' },
        { icon: 'delete_outline', label: 'Trash', path: '/trash' },
      ],
    },
  ];
}
