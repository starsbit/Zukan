import { effect, inject, Injectable, untracked } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { DemoNoticeDialogComponent } from '../components/demo-notice-dialog/demo-notice-dialog.component';
import { DemoModeService } from './demo-mode.service';

@Injectable({ providedIn: 'root' })
export class DemoNoticeService {
  private readonly demo = inject(DemoModeService);
  private readonly dialog = inject(MatDialog);
  private opened = false;

  constructor() {
    effect(() => {
      if (this.demo.enabled() && !this.demo.noticeSeen()) {
        untracked(() => this.show());
      }
    });
  }

  show(): void {
    if (this.opened) return;
    this.opened = true;
    this.demo.markNoticeSeen();
    this.dialog
      .open(DemoNoticeDialogComponent, { width: '480px', maxWidth: '95vw', closeOnNavigation: false })
      .afterClosed()
      .subscribe(() => (this.opened = false));
  }
}
