import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'zukan-navbar-brand',
  imports: [MatButtonModule],
  templateUrl: './navbar-brand.component.html',
  styleUrl: './navbar-brand.component.scss',
})
export class NavbarBrandComponent {}
