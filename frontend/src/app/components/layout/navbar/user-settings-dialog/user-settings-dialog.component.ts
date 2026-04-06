import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';
import { ApiKeyStatusResponse, UserUpdate } from '../../../../models/auth';
import { UserStore } from '../../../../services/user.store';
import { UsersClientService } from '../../../../services/web/users-client.service';

@Component({
  selector: 'zukan-user-settings-dialog',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './user-settings-dialog.component.html',
  styleUrl: './user-settings-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserSettingsDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<UserSettingsDialogComponent>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly userStore = inject(UserStore);
  private readonly usersClient = inject(UsersClientService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly apiKeyLoading = signal(false);
  readonly apiKeyError = signal<string | null>(null);
  readonly apiKeyStatus = signal<ApiKeyStatusResponse | null>(null);
  readonly createdApiKey = signal<string | null>(null);
  readonly currentUser = this.userStore.currentUser();

  readonly form = this.fb.nonNullable.group({
    showNsfw: [this.currentUser?.show_nsfw ?? false],
    showSensitive: [this.currentUser?.show_sensitive ?? false],
    tagConfidenceThreshold: [
      this.currentUser?.tag_confidence_threshold ?? 0.5,
      [Validators.required, Validators.min(0), Validators.max(1)],
    ],
    password: [''],
    confirmPassword: [''],
  });

  ngOnInit(): void {
    this.loadApiKeyStatus();
  }

  save(): void {
    if (this.loading() || this.form.invalid || !this.currentUser) {
      this.form.markAllAsTouched();
      return;
    }

    const { showNsfw, showSensitive, tagConfidenceThreshold, password, confirmPassword } = this.form.getRawValue();

    if (password && password !== confirmPassword) {
      this.error.set('Passwords do not match.');
      return;
    }

    this.error.set(null);
    this.loading.set(true);

    const body: UserUpdate = {
      show_nsfw: showNsfw,
      show_sensitive: showSensitive,
      tag_confidence_threshold: Number(tagConfidenceThreshold),
      version: this.currentUser.version,
    };

    if (password) {
      body.password = password;
    }

    this.usersClient.updateMe(body).pipe(
      takeUntilDestroyed(this.destroyRef),
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

  createApiKey(): void {
    if (this.apiKeyLoading() || !this.currentUser) {
      return;
    }

    this.apiKeyLoading.set(true);
    this.apiKeyError.set(null);

    this.usersClient.createApiKey().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.apiKeyLoading.set(false)),
    ).subscribe({
      next: (response) => {
        this.apiKeyStatus.set({
          has_key: response.has_key,
          created_at: response.created_at,
          last_used_at: response.last_used_at,
        });
        this.createdApiKey.set(response.api_key);
      },
      error: (err: { error?: { detail?: string } }) => {
        this.apiKeyError.set(err.error?.detail ?? 'Unable to create API key.');
      },
    });
  }

  copyApiKey(): void {
    const key = this.createdApiKey();
    if (!key || !navigator.clipboard) {
      this.snackBar.open('Clipboard access is unavailable.', 'Close', { duration: 4000 });
      return;
    }

    void navigator.clipboard.writeText(key).then(
      () => this.snackBar.open('API key copied.', 'Close', { duration: 3000 }),
      () => this.snackBar.open('Unable to copy API key.', 'Close', { duration: 4000 }),
    );
  }

  private loadApiKeyStatus(): void {
    this.apiKeyLoading.set(true);
    this.apiKeyError.set(null);

    this.usersClient.getApiKeyStatus().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.apiKeyLoading.set(false)),
    ).subscribe({
      next: (status) => {
        this.apiKeyStatus.set(status);
      },
      error: (err: { error?: { detail?: string } }) => {
        this.apiKeyStatus.set(null);
        this.apiKeyError.set(err.error?.detail ?? 'Unable to load API key status.');
      },
    });
  }
}
