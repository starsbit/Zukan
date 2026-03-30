import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';

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
})
export class SidebarComponent {
  readonly navigationSections: NavigationSection[] = [
    {
      label: 'Browse',
      items: [
        { icon: 'home', label: 'Home', path: '/' },
        { icon: 'photo_library', label: 'Gallery', path: '/gallery' },
        { icon: 'favorite', label: 'Favorites', path: '/favorites' },
      ],
    },
    {
      label: 'Library',
      items: [
        { icon: 'collections_bookmark', label: 'Album', path: '/album' },
        { icon: 'delete_outline', label: 'Trash', path: '/trash' },
      ],
    },
  ];
}
