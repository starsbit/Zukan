import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DemoNoticeService } from './services/demo-notice.service';
import { StorageSetupService } from './services/storage-setup.service';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'zukan-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  // Eagerly instantiate so the theme class is applied before first render.
  protected readonly theme = inject(ThemeService);
  protected readonly storageSetup = inject(StorageSetupService);
  protected readonly demoNotice = inject(DemoNoticeService);
}
