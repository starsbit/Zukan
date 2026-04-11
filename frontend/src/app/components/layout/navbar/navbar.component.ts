import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NavbarActionsComponent } from './navbar-actions/navbar-actions.component';
import { NavbarBrandComponent } from './navbar-brand/navbar-brand.component';
import { NavbarSearchComponent } from './navbar-search/navbar-search.component';

@Component({
  selector: 'zukan-navbar',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatToolbarModule,
    NavbarActionsComponent,
    NavbarBrandComponent,
    NavbarSearchComponent,
  ],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
})
export class NavbarComponent {
  readonly showMenuToggle = input(false);
  readonly menuToggle = output<void>();

  onMenuToggle(): void {
    this.menuToggle.emit();
  }
}
