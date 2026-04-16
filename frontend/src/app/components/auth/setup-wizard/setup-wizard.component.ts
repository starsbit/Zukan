import { Component, inject, input, output, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatStepperModule } from '@angular/material/stepper';

export interface SetupFormValue {
  username: string;
  password: string;
}

function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password');
  const confirm = control.get('confirmPassword');
  if (password && confirm && password.value && confirm.value !== password.value) {
    return { passwordMismatch: true };
  }
  return null;
}

@Component({
  selector: 'zukan-setup-wizard',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatStepperModule,
  ],
  templateUrl: './setup-wizard.component.html',
  styleUrl: './setup-wizard.component.scss',
})
export class SetupWizardComponent {
  readonly loading = input(false);
  readonly submitted = output<SetupFormValue>();

  private readonly fb = inject(FormBuilder);

  readonly credentialsForm = this.fb.nonNullable.group(
    {
      username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(64)]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordMatchValidator },
  );

  readonly error = signal<string | null>(null);
  hidePassword = true;
  hideConfirm = true;

  setError(message: string | null): void {
    this.error.set(message);
  }

  onSubmit(): void {
    if (this.credentialsForm.invalid || this.loading()) return;
    this.error.set(null);
    const { username, password } = this.credentialsForm.getRawValue();
    this.submitted.emit({ username, password });
  }
}
