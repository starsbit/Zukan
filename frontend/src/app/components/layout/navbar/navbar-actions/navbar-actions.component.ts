import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { NavbarNotificationsComponent } from '../navbar-notifications/navbar-notifications.component';
import { NavbarProfileComponent } from '../navbar-profile/navbar-profile.component';
import { NavbarThemeToggleComponent } from '../navbar-theme-toggle/navbar-theme-toggle.component';
import { NavbarUploadComponent } from '../navbar-upload/navbar-upload.component';

@Component({
  selector: 'zukan-navbar-actions',
  imports: [
    MatButtonModule,
    NavbarNotificationsComponent,
    NavbarProfileComponent,
    NavbarThemeToggleComponent,
    NavbarUploadComponent,
  ],
  templateUrl: './navbar-actions.component.html',
  styleUrl: './navbar-actions.component.scss',
})
export class NavbarActionsComponent {}
