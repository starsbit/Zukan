import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SidebarComponent } from './sidebar.component';

describe('SidebarComponent', () => {
  it('renders grouped navigation links for all top-level pages', async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[matlistitemtitle]'),
    ).map((title) => title.textContent?.trim());
    const sectionTitles = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.section-title'))
      .map((title) => title.textContent?.trim());

    expect(labels).toEqual(['Home', 'Gallery', 'Favorites', 'Album', 'Trash']);
    expect(sectionTitles).toEqual(['Browse', 'Library']);
  });
});
