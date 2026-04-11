import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
export class LayoutComponent {
  private static readonly MOBILE_LAYOUT_QUERY = '(max-width: 1023px)';
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly destroyRef = inject(DestroyRef);

  readonly isMobile = signal(false);
  readonly sidenavOpened = signal(true);

  constructor() {
    this.breakpointObserver.observe(LayoutComponent.MOBILE_LAYOUT_QUERY)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ matches }) => {
        this.isMobile.set(matches);
        this.sidenavOpened.set(!matches);
      });
  }

  toggleSidenav(): void {
    this.sidenavOpened.update((opened) => !opened);
  }
}
