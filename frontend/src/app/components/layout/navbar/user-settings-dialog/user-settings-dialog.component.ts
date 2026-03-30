import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize } from 'rxjs';
import { UserRead, UserUpdate } from '../../../../models/auth';
import { UserStore } from '../../../../services/user.store';
import { UsersClientService } from '../../../../services/web/users-client.service';

@Component({
  selector: 'zukan-user-settings-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './user-settings-dialog.component.html',
  styleUrl: './user-settings-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserSettingsDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<UserSettingsDialogComponent>);
  private readonly fb = inject(FormBuilder);
  private readonly userStore = inject(UserStore);
  private readonly usersClient = inject(UsersClientService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly currentUser = this.userStore.currentUser();

  readonly form = this.fb.nonNullable.group({
    showNsfw: [this.currentUser?.show_nsfw ?? false],
    tagConfidenceThreshold: [
      this.currentUser?.tag_confidence_threshold ?? 0.5,
      [Validators.required, Validators.min(0), Validators.max(1)],
    ],
    password: [''],
    confirmPassword: [''],
  });

  save(): void {
    if (this.loading() || this.form.invalid || !this.currentUser) {
      this.form.markAllAsTouched();
      return;
    }

    const { showNsfw, tagConfidenceThreshold, password, confirmPassword } = this.form.getRawValue();

    if (password && password !== confirmPassword) {
      this.error.set('Passwords do not match.');
      return;
    }

    this.error.set(null);
    this.loading.set(true);

    const body: UserUpdate = {
      show_nsfw: showNsfw,
      tag_confidence_threshold: Number(tagConfidenceThreshold),
      version: this.currentUser.version,
    };

    if (password) {
      body.password = password;
    }

    this.usersClient.updateMe(body).pipe(
      finalize(() => this.loading.set(false)),
    ).subscribe({
      next: (user) => {
        this.userStore.set(user);
        this.dialogRef.close(user);
      },
      error: (err: { error?: { detail?: string } }) => {
        this.error.set(err.error?.detail ?? 'Unable to save settings.');
      },
    });
  }
}
