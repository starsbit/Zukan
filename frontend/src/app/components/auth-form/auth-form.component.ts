import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { finalize } from 'rxjs';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-auth-form',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTabsModule
  ],
  templateUrl: './auth-form.component.html',
  styleUrl: './auth-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuthFormComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  readonly loginForm = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
    rememberMe: [true]
  });

  readonly registerForm = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', [Validators.required, matchControlValueValidator('password')]]
  });

  submittingLogin = false;
  submittingRegister = false;
  hideLoginPassword = true;
  hideRegisterPassword = true;
  hideConfirmPassword = true;

  constructor() {
    this.registerForm.controls.password.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.registerForm.controls.confirmPassword.updateValueAndValidity({ onlySelf: true });
      });
  }

  login(): void {
    if (this.loginForm.invalid || this.submittingLogin || this.submittingRegister) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.submittingLogin = true;

    const { username, password, rememberMe } = this.loginForm.getRawValue();
    this.authService.login({
      username,
      password,
      remember_me: rememberMe
    }).pipe(
      finalize(() => {
        this.submittingLogin = false;
      })
    ).subscribe({
      next: () => {
        this.openSnackBar('Welcome back.');
        void this.router.navigate(['/gallery']);
      },
      error: () => {
        this.openSnackBar('Login failed. Please check your credentials.');
      }
    });
  }

  register(): void {
    if (this.registerForm.invalid || this.submittingLogin || this.submittingRegister) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.submittingRegister = true;

    const { username, email, password } = this.registerForm.getRawValue();
    this.authService.register({
      username,
      email,
      password
    }).pipe(
      finalize(() => {
        this.submittingRegister = false;
      })
    ).subscribe({
      next: () => {
        this.openSnackBar('Account created.');
        void this.router.navigate(['/gallery']);
      },
      error: () => {
        this.openSnackBar('Registration failed. Please try again.');
      }
    });
  }

  private openSnackBar(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000
    });
  }
}

function matchControlValueValidator(otherControlName: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const parent = control.parent;
    const otherValue = parent?.get(otherControlName)?.value;
    const currentValue = control.value;

    if (!parent || !currentValue) {
      return null;
    }

    return otherValue === currentValue ? null : { fieldMismatch: true };
  };
}
