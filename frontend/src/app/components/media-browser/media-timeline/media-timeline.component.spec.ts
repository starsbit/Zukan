import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { GalleryTimelineYear } from '../../../models/gallery-browser';
import { MediaTimelineComponent } from './media-timeline.component';

describe('MediaTimelineComponent', () => {
  it('renders timeline entries and emits month jumps', async () => {
    await TestBed.configureTestingModule({
      imports: [MediaTimelineComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaTimelineComponent);
    const entries: GalleryTimelineYear[] = [
      {
        year: 2026,
        count: 10,
        months: [
          { year: 2026, month: 3, count: 7, position: 0, rendered: true, anchorId: 'gallery-day-2026-03-28' },
          { year: 2026, month: 2, count: 3, position: 100, rendered: false, anchorId: null },
        ],
      },
    ];
    fixture.componentRef.setInput('entries', entries);
    fixture.componentRef.setInput('activeYear', 2026);
    fixture.componentRef.setInput('activeMonthKey', '2026-03');
    fixture.componentRef.setInput('activeProgress', 0);

    const emitted: string[] = [];
    fixture.componentInstance.jumpRequested.subscribe(value => emitted.push(value));

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('2026');
    const monthButtons = Array.from(element.querySelectorAll('.media-timeline__month'));
    expect(monthButtons).toHaveLength(2);
    expect(monthButtons[0].classList.contains('media-timeline__month--active')).toBe(true);
    expect(element.querySelector('.media-timeline__chip')?.textContent).toContain('Mar 2026');

    (monthButtons[1] as HTMLButtonElement).click();
    expect(emitted).toEqual(['2026-02']);
  });

  it('positions years and the active chip along the full rail', async () => {
    await TestBed.configureTestingModule({
      imports: [MediaTimelineComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaTimelineComponent);
    fixture.componentRef.setInput('entries', [
      {
        year: 2026,
        count: 2,
        months: [
          { year: 2026, month: 9, count: 1, position: 0, rendered: true, anchorId: 'a' },
          { year: 2026, month: 3, count: 1, position: 33.333, rendered: true, anchorId: 'b' },
        ],
      },
      {
        year: 2025,
        count: 2,
        months: [
          { year: 2025, month: 9, count: 1, position: 66.666, rendered: false, anchorId: 'c' },
          { year: 2025, month: 1, count: 1, position: 100, rendered: false, anchorId: 'd' },
        ],
      },
    ] satisfies GalleryTimelineYear[]);
    fixture.componentRef.setInput('activeYear', 2025);
    fixture.componentRef.setInput('activeMonthKey', '2025-09');
    fixture.componentRef.setInput('activeProgress', 100);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const yearButtons = Array.from(element.querySelectorAll('.media-timeline__year')) as HTMLButtonElement[];
    expect(yearButtons[0]?.style.top).toBe('0%');
    expect(yearButtons[1]?.style.top).not.toBe('');

    const chip = element.querySelector('.media-timeline__chip') as HTMLElement | null;
    expect(chip?.textContent).toContain('Sep 2025');
    expect(chip?.style.top).toBe('100%');
  });
});
