import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DemoModeService } from '../../../../services/demo-mode.service';
import { DemoNoticeService } from '../../../../services/demo-notice.service';

@Component({
  selector: 'zukan-navbar-brand',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './navbar-brand.component.html',
  styleUrl: './navbar-brand.component.scss',
})
export class NavbarBrandComponent {
  readonly demo = inject(DemoModeService).enabled;
  private readonly notice = inject(DemoNoticeService);

  showNotice(): void {
    this.notice.show();
  }
}
