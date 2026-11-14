import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { LoginPageComponent } from './login-page.component';
import { AuthService } from '../../services/auth.service';
import { DemoModeService } from '../../services/demo-mode.service';

describe('Owner login', () => {
  async function render(
    mode: 'local' | 'oidc',
    {
      query = {},
      signedOut = false,
      demo = false,
    }: { query?: Record<string, string>; signedOut?: boolean; demo?: boolean } = {},
  ) {
    const auth = {
      configuration: () => of({ mode, setup_required: false, demo }),
      login: vi.fn(() => of(void 0)),
      demo: vi.fn(() => of(void 0)),
      setup: vi.fn(() => of(void 0)),
      startSso: vi.fn(),
      isSignedOut: () => signedOut,
    };
    await TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthService, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: new Map(Object.entries(query)) } },
        },
      ],
    }).compileComponents();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginPageComponent);
    fixture.detectChanges();
    return { fixture, auth, navigate };
  }
  it('shows local login without registration', async () => {
    const { fixture } = await render('local');
    expect(fixture.nativeElement.querySelector('zukan-login-form')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('Register');
  });
  it('never starts SSO for a local installation', async () => {
    const { auth } = await render('local');
    expect(auth.startSso).not.toHaveBeenCalled();
  });
  it('redirects to the provider for the requested page without showing the button', async () => {
    const { fixture, auth } = await render('oidc', { query: { returnUrl: '/album/1' } });
    expect(auth.startSso).toHaveBeenCalledWith('/album/1', true);
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(fixture.nativeElement.querySelector('zukan-login-form')).toBeNull();
  });
  it('reports a failed SSO attempt and only retries from the button', async () => {
    const { fixture, auth } = await render('oidc', { query: { sso: 'failed' } });
    expect(auth.startSso).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    fixture.nativeElement.querySelector('button').click();
    expect(auth.startSso).toHaveBeenCalledWith('/');
  });
  it('signs straight into the demo without a login form', async () => {
    const { fixture, auth, navigate } = await render('local', {
      demo: true,
      query: { returnUrl: '/album/1' },
    });
    expect(auth.demo).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/album/1', { replaceUrl: true });
    expect(fixture.nativeElement.querySelector('zukan-login-form')).toBeNull();
    expect(TestBed.inject(DemoModeService).enabled()).toBe(true);
  });
  it('clears demo mode for a regular installation', async () => {
    const { auth } = await render('local');
    expect(auth.demo).not.toHaveBeenCalled();
    expect(TestBed.inject(DemoModeService).enabled()).toBe(false);
  });
  it('stays on the button after an explicit sign out', async () => {
    const { fixture, auth } = await render('oidc', { signedOut: true });
    expect(auth.startSso).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('button')).toBeTruthy();
  });
});
