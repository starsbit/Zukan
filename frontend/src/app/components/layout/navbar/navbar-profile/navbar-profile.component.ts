import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { catchError, of, switchMap } from 'rxjs';
import { AuthService } from '../../../../services/auth.service';
import { MediaService } from '../../../../services/media.service';
import { UserStore } from '../../../../services/user.store';
import { UserSettingsDialogComponent } from '../user-settings-dialog/user-settings-dialog.component';
import { ContactDialogComponent } from '../../../../components/contact-dialog/contact-dialog.component';

@Component({
  selector: 'zukan-navbar-profile',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    RouterLink,
  ],
  templateUrl: './navbar-profile.component.html',
  styleUrl: './navbar-profile.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavbarProfileComponent {
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly userStore = inject(UserStore);
  private readonly mediaService = inject(MediaService);

  readonly user = this.userStore.currentUser;
  readonly authenticated = this.userStore.currentUser;
  readonly avatarLetter = computed(() => {
    const username = this.user()?.username?.trim();
    return username ? username.charAt(0).toUpperCase() : '?';
  });

  readonly avatarUrl = toSignal(
    toObservable(this.userStore.avatarMediaId).pipe(
      switchMap(id =>
        id ? this.mediaService.getAvatarUrl(id).pipe(catchError(() => of(null))) : of(null),
      ),
    ),
    { initialValue: null },
  );

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

  openContact(): void {
    this.dialog.open(ContactDialogComponent, { width: '400px' });
  }
}
