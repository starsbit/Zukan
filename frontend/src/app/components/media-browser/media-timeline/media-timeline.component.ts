import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { GalleryTimelineMonth, GalleryTimelineYear } from '../../../models/gallery-browser';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RAIL_PADDING = 20;
const MIN_LABEL_DISTANCE = 16;

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
  readonly scrollRequested = output<number>();

  @ViewChild('rail') private readonly railRef?: ElementRef<HTMLElement>;

  readonly isDragging = signal(false);
  readonly pointerProgress = signal<number | null>(null);
  readonly railHeight = signal(600);

  readonly hasEntries = computed(() => this.entries().length > 0);
  readonly flatMonths = computed(() => this.entries().flatMap(entry => entry.months));
  readonly activeMonth = computed(() =>
    this.flatMonths().find(month => this.monthKey(month.year, month.month) === this.activeMonthKey()) ?? null,
  );
  readonly activeMonthLabel = computed(() => {
    const month = this.activeMonth();
    return month ? `${this.monthLabel(month.month)} ${month.year}` : null;
  });
  readonly indicatorProgress = computed(() => {
    const p = this.pointerProgress();
    if (p !== null) return p * 100;
    return this.activeProgress() ?? (this.activeMonth() ? this.monthPosition(this.activeMonth()!) : null);
  });
  readonly hoveredMonth = computed(() => {
    const p = this.pointerProgress();
    if (p === null) return null;
    const pos = p * 100;
    const months = this.flatMonths();
    return months.reduce<GalleryTimelineMonth | null>(
      (best, m) => best === null || Math.abs(m.position - pos) < Math.abs(best.position - pos) ? m : best,
      null,
    );
  });
  readonly hoveredLabel = computed(() => {
    const m = this.hoveredMonth();
    return m ? `${this.monthLabel(m.month)} ${m.year}` : null;
  });
  readonly visibleEntries = computed(() => {
    const usable = Math.max(this.railHeight() - RAIL_PADDING * 2, 1);
    let lastLabelY = -Infinity;
    return this.entries().map(entry => {
      const y = (this.yearPosition(entry) / 100) * usable;
      const showLabel = (y - lastLabelY) >= MIN_LABEL_DISTANCE;
      if (showLabel) lastLabelY = y;
      return { entry, showLabel };
    });
  });

  private resizeObserver?: ResizeObserver;

  ngAfterViewInit(): void {
    const rail = this.railRef?.nativeElement;
    if (rail && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(entries => {
        this.railHeight.set(entries[0]?.contentRect.height ?? 600);
      });
      this.resizeObserver.observe(rail);
      this.railHeight.set(rail.clientHeight);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

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
    if (!target) return;
    this.jumpRequested.emit(this.monthKey(target.year, target.month));
  }

  monthPosition(month: GalleryTimelineMonth): number {
    return month.position;
  }

  yearPosition(entry: GalleryTimelineYear): number {
    const anchor = entry.months[0];
    return anchor ? this.monthPosition(anchor) : 0;
  }

  onRailPointerDown(event: PointerEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    this.applyPointer(event);
  }

  onRailPointerMove(event: PointerEvent): void {
    this.applyPointer(event);
  }

  onRailPointerUp(event: PointerEvent): void {
    (event.currentTarget as Element).releasePointerCapture(event.pointerId);
    this.isDragging.set(false);
    this.pointerProgress.set(null);
  }

  onRailPointerEnter(event: PointerEvent): void {
    if (!this.isDragging()) this.applyPointer(event);
  }

  onRailPointerLeave(): void {
    if (!this.isDragging()) this.pointerProgress.set(null);
  }

  private applyPointer(event: PointerEvent): void {
    const rail = this.railRef?.nativeElement;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const usable = rect.height - RAIL_PADDING * 2;
    const y = event.clientY - rect.top - RAIL_PADDING;
    const progress = Math.max(0, Math.min(1, usable > 0 ? y / usable : 0));
    this.pointerProgress.set(progress);
    if (this.isDragging()) this.scrollRequested.emit(progress);
  }
}
