import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { MediaRead } from '../../models/api';
import { GalleryDayGroup } from '../../utils/gallery-grouping.utils';
import { GalleryMediaCardComponent } from '../gallery-media-card/gallery-media-card.component';

@Component({
  selector: 'app-media-grouped-list',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, GalleryMediaCardComponent],
  templateUrl: './media-grouped-list.component.html',
  styleUrl: './media-grouped-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MediaGroupedListComponent {
  @Input({ required: true }) groups: GalleryDayGroup[] = [];
  @Input({ required: true }) selectedIds: Set<string> = new Set<string>();
  @Input() selectionMode = false;
  @Input() trashMode = false;
  @Input() regroupAnimating = false;
  @Input() ariaLabel = 'Media list';

  @Output() readonly mediaOpened = new EventEmitter<MediaRead>();
  @Output() readonly mediaSelectionToggled = new EventEmitter<MediaRead>();
  @Output() readonly groupSelected = new EventEmitter<GalleryDayGroup>();
  @Output() readonly mediaRestoreRequested = new EventEmitter<MediaRead>();

  isGroupSelected(group: GalleryDayGroup): boolean {
    return group.items.length > 0 && group.items.every((item) => this.selectedIds.has(item.id));
  }
}
