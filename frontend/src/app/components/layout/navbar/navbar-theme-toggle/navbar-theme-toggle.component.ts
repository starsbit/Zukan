import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ThemePreference, ThemeService } from '../../../../services/theme.service';

const ICONS: Record<ThemePreference, string> = {
  system: 'auto_mode',
  light: 'light_mode',
  dark: 'dark_mode',
};

const LABELS: Record<ThemePreference, string> = {
  system: 'Theme: system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

@Component({
  selector: 'zukan-navbar-theme-toggle',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './navbar-theme-toggle.component.html',
  styleUrl: './navbar-theme-toggle.component.scss',
})
export class NavbarThemeToggleComponent {
  protected readonly themeService = inject(ThemeService);

  protected get themeIcon(): string {
    return ICONS[this.themeService.preference()];
  }

  protected get themeLabel(): string {
    return LABELS[this.themeService.preference()];
  }
}
