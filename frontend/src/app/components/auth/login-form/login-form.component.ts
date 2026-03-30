import { Component, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ForgotPasswordDialogComponent } from '../forgot-password-dialog/forgot-password-dialog.component';

export interface LoginFormValue {
  username: string;
  password: string;
  rememberMe: boolean;
}

@Component({
  selector: 'zukan-login-form',
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
  templateUrl: './login-form.component.html',
  styleUrl: './login-form.component.scss',
})
export class LoginFormComponent {
  readonly loading = input(false);
  readonly successMessage = input<string | null>(null);
  readonly submitted = output<LoginFormValue>();

  private readonly dialog = inject(MatDialog);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
    rememberMe: [false],
  });

  readonly error = signal<string | null>(null);
  hidePassword = true;

  setError(message: string | null): void {
    this.error.set(message);
  }

  onSubmit(): void {
    if (this.form.invalid || this.loading()) return;
    this.error.set(null);
    const { username, password, rememberMe } = this.form.getRawValue();
    this.submitted.emit({ username, password, rememberMe });
  }

  openForgotPassword(): void {
    this.dialog.open(ForgotPasswordDialogComponent, { width: '360px' });
  }
}
