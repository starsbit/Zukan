import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';

import { LoginPageComponent } from './login-page.component';
import { AuthService } from '../../services/auth.service';
import { ConfigClientService } from '../../services/web/config-client.service';

const mockUser = { id: 'u1', username: 'alice', email: 'alice@example.com', is_admin: false, show_nsfw: false, tag_confidence_threshold: 0.5, version: 1, created_at: '' };

function makeAuthService() {
  return {
    login: vi.fn(() => of(void 0)),
    register: vi.fn(() => of(mockUser)),
    setupAdmin: vi.fn(() => of(void 0)),
  };
}

function makeConfigService(setupRequired = false) {
  return {
    getSetupRequired: vi.fn(() => of({ setup_required: setupRequired })),
  };
}

describe('LoginPageComponent', () => {
  let authService: ReturnType<typeof makeAuthService>;
  let configService: ReturnType<typeof makeConfigService>;

  async function createComponent(setupRequired = false) {
    authService = makeAuthService();
    configService = makeConfigService(setupRequired);

    await TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([{ path: '**', redirectTo: '' }]),
        { provide: AuthService, useValue: authService },
        { provide: ConfigClientService, useValue: configService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginPageComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, component, el: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => TestBed.resetTestingModule());

  describe('setup card visibility', () => {
    it('hides the setup wizard when setup is not required', async () => {
      const { el } = await createComponent(false);
      expect(el.querySelector('zukan-setup-wizard')).toBeNull();
    });

    it('shows the setup wizard when setup is required', async () => {
      const { el } = await createComponent(true);
      expect(el.querySelector('zukan-setup-wizard')).not.toBeNull();
    });

    // regression: both cards were shown simultaneously when setup was required
    it('hides the auth form when setup is required', async () => {
      const { el } = await createComponent(true);
      expect(el.querySelector('zukan-login-form')).toBeNull();
      expect(el.querySelector('zukan-register-form')).toBeNull();
    });

    it('shows the auth form when setup is not required', async () => {
      const { el } = await createComponent(false);
      expect(el.querySelector('mat-tab-group')).not.toBeNull();
    });

    it('calls getSetupRequired once on init', async () => {
      await createComponent();
      expect(configService.getSetupRequired).toHaveBeenCalledTimes(1);
    });

    it('keeps setup hidden if getSetupRequired errors', async () => {
      authService = makeAuthService();
      configService = { getSetupRequired: vi.fn(() => throwError(() => new Error('network'))) };

      await TestBed.configureTestingModule({
        imports: [LoginPageComponent],
        providers: [
          provideNoopAnimations(),
          provideRouter([{ path: '**', redirectTo: '' }]),
          { provide: AuthService, useValue: authService },
          { provide: ConfigClientService, useValue: configService },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(LoginPageComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).querySelector('zukan-setup-wizard')).toBeNull();
    });
  });

  describe('login', () => {
    it('calls authService.login with submitted values', async () => {
      const { component } = await createComponent();
      component.onLogin({ username: 'alice', password: 'secret', rememberMe: true });
      expect(authService.login).toHaveBeenCalledWith('alice', 'secret', true);
    });

    it('navigates to /gallery on successful login', async () => {
      const { component, fixture } = await createComponent();
      const router = TestBed.inject(Router);
      const spy = vi.spyOn(router, 'navigateByUrl');

      component.onLogin({ username: 'alice', password: 'secret', rememberMe: false });
      await fixture.whenStable();

      expect(spy).toHaveBeenCalledWith('/');
    });

    it('navigates to returnUrl when query param is set', async () => {
      const { component, fixture } = await createComponent();
      const route = TestBed.inject(ActivatedRoute);
      vi.spyOn(route.snapshot.queryParamMap, 'get').mockReturnValue('/albums');
      const router = TestBed.inject(Router);
      const spy = vi.spyOn(router, 'navigateByUrl');

      component.onLogin({ username: 'alice', password: 'secret', rememberMe: false });
      await fixture.whenStable();

      expect(spy).toHaveBeenCalledWith('/albums');
    });

    it('clears loading and does not navigate on login error', async () => {
      const { component, fixture } = await createComponent();
      authService.login.mockReturnValue(throwError(() => ({ error: { detail: 'Invalid credentials' } })));
      const router = TestBed.inject(Router);
      const spy = vi.spyOn(router, 'navigateByUrl');

      component.onLogin({ username: 'alice', password: 'wrong', rememberMe: false });
      await fixture.whenStable();

      expect(component.loading()).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('calls authService.register with submitted values', async () => {
      const { component } = await createComponent();
      component.onRegister({ username: 'bob', email: 'bob@example.com', password: 'password1' });
      expect(authService.register).toHaveBeenCalledWith('bob', 'bob@example.com', 'password1');
    });

    it('switches to Sign In tab and shows success message on success', async () => {
      const { component, fixture } = await createComponent();
      component.selectedTab = 1;
      component.onRegister({ username: 'bob', email: 'bob@example.com', password: 'password1' });
      await fixture.whenStable();

      expect(component.selectedTab).toBe(0);
      expect(component.registerSuccess()).toContain('bob');
    });

    it('clears loading on register error', async () => {
      const { component, fixture } = await createComponent();
      authService.register.mockReturnValue(throwError(() => ({ error: { detail: 'Username taken' } })));

      component.onRegister({ username: 'bob', email: 'bob@example.com', password: 'password1' });
      await fixture.whenStable();

      expect(component.loading()).toBe(false);
    });
  });

  describe('setup', () => {
    it('calls authService.setupAdmin with submitted values', async () => {
      const { component } = await createComponent(true);
      component.onSetup({ username: 'admin2', email: 'admin@example.com', password: 'password1' });
      expect(authService.setupAdmin).toHaveBeenCalledWith('admin2', 'admin@example.com', 'password1');
    });

    it('navigates to /gallery after successful setup', async () => {
      const { component, fixture } = await createComponent(true);
      const router = TestBed.inject(Router);
      const spy = vi.spyOn(router, 'navigate');

      component.onSetup({ username: 'admin2', email: 'admin@example.com', password: 'password1' });
      await fixture.whenStable();

      expect(spy).toHaveBeenCalledWith(['/']);
    });

    it('clears loading on setup error', async () => {
      const { component, fixture } = await createComponent(true);
      authService.setupAdmin.mockReturnValue(throwError(() => ({ error: { detail: 'Setup failed' } })));

      component.onSetup({ username: 'admin2', email: 'admin@example.com', password: 'password1' });
      await fixture.whenStable();

      expect(component.loading()).toBe(false);
    });
  });
});
