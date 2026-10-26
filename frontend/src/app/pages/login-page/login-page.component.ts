import { Component, inject, OnInit, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import {
  LoginFormComponent,
  LoginFormValue,
} from '../../components/auth/login-form/login-form.component';
import {
  SetupWizardComponent,
  SetupFormValue,
} from '../../components/auth/setup-wizard/setup-wizard.component';
import { AuthService } from '../../services/auth.service';
import { extractApiError } from '../../utils/api-error.utils';

@Component({
  selector: 'zukan-login-page',
  imports: [MatCardModule, MatButtonModule, LoginFormComponent, SetupWizardComponent],
  template: `<main class="login-page">
    <mat-card
      ><mat-card-header><mat-card-title>Zukan</mat-card-title></mat-card-header>
      <mat-card-content>
        @if (error()) {
          <p role="alert">{{ error() }}</p>
        }
        @if (ready()) {
          @if (setupRequired()) {
            <zukan-setup-wizard [loading]="loading()" (submitted)="onSetup($event)" />
          } @else if (mode() === 'oidc') {
            <button mat-flat-button (click)="sso()" [disabled]="loading()">Sign in with SSO</button>
          } @else {
            <zukan-login-form [loading]="loading()" (submitted)="onLogin($event)" />
          }
        }</mat-card-content
    ></mat-card>
  </main>`,
  styleUrl: './login-page.component.scss',
})
export class LoginPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly loginForm = viewChild(LoginFormComponent);
  private readonly setupWizard = viewChild(SetupWizardComponent);
  readonly ready = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly mode = signal('local');
  readonly setupRequired = signal(false);

  private returnUrl(): string {
    const value = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
    return value.startsWith('/') && !value.startsWith('//') && !/[\\\x00-\x1f]/.test(value)
      ? value
      : '/';
  }
  ngOnInit(): void {
    const code = this.route.snapshot.queryParamMap.get('code');
    this.auth.configuration().subscribe({
      next: (config) => {
        this.mode.set(config.mode);
        this.setupRequired.set(config.setup_required);
        this.ready.set(true);
        if (code && config.mode === 'oidc') {
          const destination = this.returnUrl();
          window.history.replaceState(null, '', '/login');
          this.loading.set(true);
          this.auth
            .exchange(code)
            .subscribe({
              next: () => this.router.navigateByUrl(destination),
              error: (e) => this.failed(e),
            });
        }
      },
      error: (e) => this.failed(e),
    });
  }
  sso(): void {
    this.auth.startSso(this.returnUrl());
  }
  onLogin(value: LoginFormValue): void {
    this.loading.set(true);
    this.auth.login(value.username, value.password, value.rememberMe).subscribe({
      next: () => this.router.navigateByUrl(this.returnUrl()),
      error: (e) => this.failed(e),
    });
  }
  onSetup(value: SetupFormValue): void {
    this.loading.set(true);
    this.auth.setup(value.username, value.password, value.setupToken).subscribe({
      next: () => this.router.navigateByUrl('/'),
      error: (e) => this.failed(e),
    });
  }
  private failed(error: unknown): void {
    this.loading.set(false);
    const message = extractApiError(error);
    this.error.set(message);
    this.loginForm()?.setError(message);
    this.setupWizard()?.setError(message);
  }
}
