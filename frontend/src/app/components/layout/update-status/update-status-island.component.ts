import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AppUpdateService } from '../../../services/app-update.service';
import { UserStore } from '../../../services/user.store';

@Component({
  selector: 'zukan-update-status-island',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  templateUrl: './update-status-island.component.html',
  styleUrl: './update-status-island.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdateStatusIslandComponent {
  private readonly userStore = inject(UserStore);
  readonly updateService = inject(AppUpdateService);

  readonly visible = computed(() =>
    this.updateService.status() !== 'idle' && this.userStore.isAdmin(),
  );

  readonly icon = computed(() => {
    switch (this.updateService.status()) {
      case 'done': return 'check_circle';
      default: return 'system_update';
    }
  });

  readonly title = computed(() => {
    switch (this.updateService.status()) {
      case 'updating': return 'Update in progress';
      case 'restarting': return 'Zukan is restarting';
      case 'done': return 'Update complete';
      default: return '';
    }
  });

  readonly subtitle = computed(() => {
    switch (this.updateService.status()) {
      case 'updating': return 'Pulling latest changes…';
      case 'restarting': return 'Server restarting, please wait…';
      case 'done': return 'Ready to reload';
      default: return '';
    }
  });

  reload(): void {
    window.location.reload();
  }

  dismiss(): void {
    this.updateService.dismiss();
  }
}
