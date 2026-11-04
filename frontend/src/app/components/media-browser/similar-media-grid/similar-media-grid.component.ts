import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RelatedMediaRead } from '../../../models/media';
import { computeMasonry } from '../../../utils/masonry.utils';
import { MediaCardComponent } from '../media-card/media-card.component';

const SIDE_PADDING = 16;
const GAP = 12;
const MIN_COLUMN_WIDTH = 220;
const MIN_COLUMNS = 2;

@Component({
  selector: 'zukan-similar-media-grid',
  imports: [MediaCardComponent],
  templateUrl: './similar-media-grid.component.html',
  styleUrl: './similar-media-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SimilarMediaGridComponent {
  readonly items = input.required<RelatedMediaRead[]>();
  readonly loading = input(false);
  readonly containerWidth = input.required<number>();

  readonly selected = output<RelatedMediaRead>();
  readonly favoriteToggled = output<RelatedMediaRead>();

  readonly layout = computed(() => {
    const width = Math.max(this.containerWidth() - SIDE_PADDING * 2, 0);
    const columns = Math.max(MIN_COLUMNS, Math.floor((width + GAP) / (MIN_COLUMN_WIDTH + GAP)));
    return computeMasonry(this.items(), width, columns, GAP);
  });
}
