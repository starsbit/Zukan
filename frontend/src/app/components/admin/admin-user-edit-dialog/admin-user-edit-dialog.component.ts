import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { startWith } from 'rxjs';
import { AdminUserSummary, AdminUserUpdate } from '../../../models/admin';

export interface AdminUserEditDialogData {
  user: AdminUserSummary;
  currentUserId: string | null;
}

@Component({
  selector: 'zukan-admin-user-edit-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './admin-user-edit-dialog.component.html',
  styleUrl: './admin-user-edit-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUserEditDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<AdminUserEditDialogComponent, AdminUserUpdate | null>);
  protected readonly data = inject<AdminUserEditDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);

  readonly error = signal<string | null>(null);
  readonly isSelf = this.data.currentUserId === this.data.user.id;
  readonly form = this.fb.nonNullable.group({
    username: [this.data.user.username, [Validators.required, Validators.minLength(3), Validators.maxLength(64)]],
    isAdmin: [{ value: this.data.user.is_admin, disabled: this.isSelf }],
    password: ['', [Validators.minLength(8)]],
    confirmPassword: [''],
  });
  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(startWith(this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );

  readonly hasChanges = computed(() => {
    const raw = this.formValue();
    return (
      (raw.username ?? '').trim() !== this.data.user.username
      || raw.isAdmin !== this.data.user.is_admin
      || (raw.password ?? '').trim().length > 0
    );
  });

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { username, isAdmin, password, confirmPassword } = this.form.getRawValue();
    if (password && password !== confirmPassword) {
      this.error.set('Passwords do not match.');
      return;
    }

    const body: AdminUserUpdate = {};
    const trimmedUsername = username.trim();
    if (trimmedUsername !== this.data.user.username) {
      body.username = trimmedUsername;
    }
    if (!this.isSelf && isAdmin !== this.data.user.is_admin) {
      body.is_admin = isAdmin;
    }
    if (password.trim()) {
      body.password = password.trim();
    }
    if (body.username == null && body.password == null && body.is_admin == null) {
      this.error.set('Change the username, admin access, or set a new password before saving.');
      return;
    }

    this.error.set(null);
    this.dialogRef.close(body);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
