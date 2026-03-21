import { ChangeDetectionStrategy, Component } from '@angular/core';

import { AuthFormComponent } from '../../components/auth-form/auth-form.component';

@Component({
  selector: 'app-login-page',
  imports: [AuthFormComponent],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginPageComponent {}
