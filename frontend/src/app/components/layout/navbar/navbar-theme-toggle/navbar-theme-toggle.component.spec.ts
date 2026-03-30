import { TestBed } from '@angular/core/testing';
import { ThemeService } from '../../../../services/theme.service';
import { NavbarThemeToggleComponent } from './navbar-theme-toggle.component';

describe('NavbarThemeToggleComponent', () => {
  it('renders the icon for the current theme preference', async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarThemeToggleComponent],
      providers: [
        { provide: ThemeService, useValue: { preference: () => 'system', cycle: () => {} } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NavbarThemeToggleComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('auto_mode');
  });
});
