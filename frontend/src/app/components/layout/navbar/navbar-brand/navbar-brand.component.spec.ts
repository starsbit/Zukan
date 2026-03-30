import { TestBed } from '@angular/core/testing';
import { NavbarBrandComponent } from './navbar-brand.component';

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
});
