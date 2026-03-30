import { Component, inject, OnInit, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import { LoginFormComponent, LoginFormValue } from '../../components/auth/login-form/login-form.component';
import { RegisterFormComponent, RegisterFormValue } from '../../components/auth/register-form/register-form.component';
import { SetupWizardComponent, SetupFormValue } from '../../components/auth/setup-wizard/setup-wizard.component';
import { AuthService } from '../../services/auth.service';
import { ConfigClientService } from '../../services/web/config-client.service';
import { extractApiError } from '../../utils/api-error.utils';

@Component({
  selector: 'zukan-login-page',
  imports: [
    MatCardModule,
    MatDividerModule,
    MatTabsModule,
    LoginFormComponent,
    RegisterFormComponent,
    SetupWizardComponent,
  ],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss',
})
export class LoginPageComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly configClient = inject(ConfigClientService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly loginForm = viewChild(LoginFormComponent);
  private readonly registerForm = viewChild(RegisterFormComponent);
  private readonly setupWizard = viewChild(SetupWizardComponent);

  selectedTab = 0;
  readonly loading = signal(false);
  readonly registerSuccess = signal<string | null>(null);
  readonly setupRequired = signal(false);

  ngOnInit(): void {
    this.configClient.getSetupRequired().subscribe({
      next: ({ setup_required }) => this.setupRequired.set(setup_required),
      error: () => {},
    });
  }

  onLogin(value: LoginFormValue): void {
    this.loading.set(true);
    this.authService.login(value.username, value.password, value.rememberMe).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
        this.router.navigateByUrl(returnUrl);
      },
      error: (err) => {
        this.loading.set(false);
        this.loginForm()?.setError(extractApiError(err));
      },
    });
  }

  onRegister(value: RegisterFormValue): void {
    this.loading.set(true);
    this.authService.register(value.username, value.email, value.password).subscribe({
      next: () => {
        this.loading.set(false);
        this.registerSuccess.set(`Account created! Sign in as ${value.username}.`);
        this.selectedTab = 0;
      },
      error: (err) => {
        this.loading.set(false);
        this.registerForm()?.setError(extractApiError(err));
      },
    });
  }

  onSetup(value: SetupFormValue): void {
    this.loading.set(true);
    this.authService.setupAdmin(value.username, value.email, value.password).subscribe({
      next: () => {
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.loading.set(false);
        this.setupWizard()?.setError(extractApiError(err));
      },
    });
  }
}
