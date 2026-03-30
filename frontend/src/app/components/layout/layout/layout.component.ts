import { Component } from '@angular/core';
import { MatSidenavModule } from '@angular/material/sidenav';
import { NavbarComponent } from '../navbar/navbar.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { UploadStatusIslandComponent } from '../upload-status/upload-status-island/upload-status-island.component';

@Component({
  selector: 'zukan-layout',
  imports: [MatSidenavModule, NavbarComponent, SidebarComponent, UploadStatusIslandComponent],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss',
})
export class LayoutComponent {}
