import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../../services/auth.service';
import { UserStore } from '../../../../services/user.store';
import { UserSettingsDialogComponent } from '../user-settings-dialog/user-settings-dialog.component';

@Component({
  selector: 'zukan-navbar-profile',
  imports: [MatButtonModule, MatDialogModule, MatDividerModule, MatIconModule, MatMenuModule, RouterLink],
  templateUrl: './navbar-profile.component.html',
  styleUrl: './navbar-profile.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavbarProfileComponent {
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly userStore = inject(UserStore);

  readonly user = this.userStore.currentUser;
  readonly isAdmin = this.userStore.isAdmin;
  readonly avatarLetter = computed(() => {
    const username = this.user()?.username?.trim();
    return username ? username.charAt(0).toUpperCase() : '?';
  });

  signOut(): void {
    this.authService.logout().subscribe({
      error: () => {
        // AuthService finalizes local cleanup even on request failure.
      },
    });
  }

  openSettings(): void {
    this.dialog.open(UserSettingsDialogComponent, { width: '520px' });
  }
}
