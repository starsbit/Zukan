import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { GalleryTimelineMonth, GalleryTimelineYear } from '../../../models/gallery-browser';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Component({
  selector: 'zukan-media-timeline',
  templateUrl: './media-timeline.component.html',
  styleUrl: './media-timeline.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaTimelineComponent {
  readonly entries = input<GalleryTimelineYear[]>([]);
  readonly activeYear = input<number | null>(null);
  readonly activeMonthKey = input<string | null>(null);
  readonly activeProgress = input<number | null>(null);
  readonly jumpRequested = output<string>();

  readonly hasEntries = computed(() => this.entries().length > 0);
  readonly flatMonths = computed(() => this.entries().flatMap(entry => entry.months));
  readonly activeMonth = computed(() =>
    this.flatMonths().find(month => this.monthKey(month.year, month.month) === this.activeMonthKey()) ?? null,
  );
  readonly activeMonthLabel = computed(() => {
    const month = this.activeMonth();
    return month ? `${this.monthLabel(month.month)} ${month.year}` : null;
  });

  monthKey(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  monthLabel(month: number): string {
    return MONTH_LABELS[month - 1] ?? String(month);
  }

  jumpToMonth(year: number, month: number): void {
    this.jumpRequested.emit(this.monthKey(year, month));
  }

  jumpToYear(entry: GalleryTimelineYear): void {
    const target = entry.months[0];
    if (!target) {
      return;
    }
    this.jumpRequested.emit(this.monthKey(target.year, target.month));
  }

  monthPosition(month: GalleryTimelineMonth): number {
    return month.position;
  }

  yearPosition(entry: GalleryTimelineYear): number {
    const anchor = entry.months[0];
    return anchor ? this.monthPosition(anchor) : 0;
  }
}
