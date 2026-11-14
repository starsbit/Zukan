import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { NavbarBrandComponent } from './navbar-brand.component';
import { DemoModeService } from '../../../../services/demo-mode.service';
import { DemoNoticeService } from '../../../../services/demo-notice.service';

describe('NavbarBrandComponent', () => {
  it('renders both theme logo assets', async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarBrandComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(NavbarBrandComponent);
    fixture.detectChanges();

    const sources = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('img'))
      .map((image) => image.getAttribute('src'));

    expect(sources).toEqual([
      '/assets/starsbit-logo-black.webp',
      '/assets/starsbit-logo-white.webp',
    ]);
  });

  async function render(demo: boolean) {
    const show = vi.fn();
    await TestBed.configureTestingModule({
      imports: [NavbarBrandComponent],
      providers: [
        { provide: DemoModeService, useValue: { enabled: signal(demo) } },
        { provide: DemoNoticeService, useValue: { show } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(NavbarBrandComponent);
    fixture.detectChanges();
    return { element: fixture.nativeElement as HTMLElement, show };
  }

  it('hides the demo badge on regular instances', async () => {
    const { element } = await render(false);
    expect(element.querySelector('.demo-badge')).toBeNull();
  });

  it('shows a permanent demo badge that reopens the notice', async () => {
    const { element, show } = await render(true);
    const badge = element.querySelector<HTMLButtonElement>('.demo-badge');
    expect(badge?.textContent).toContain('Demo');
    badge!.click();
    expect(show).toHaveBeenCalled();
  });
});

