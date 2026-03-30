import { Component } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NavbarActionsComponent } from './navbar-actions/navbar-actions.component';
import { NavbarBrandComponent } from './navbar-brand/navbar-brand.component';
import { NavbarSearchComponent } from './navbar-search/navbar-search.component';

@Component({
  selector: 'zukan-navbar',
  imports: [MatToolbarModule, NavbarActionsComponent, NavbarBrandComponent, NavbarSearchComponent],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
})
export class NavbarComponent {}
