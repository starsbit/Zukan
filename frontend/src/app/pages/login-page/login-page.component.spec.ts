import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { LoginPageComponent } from './login-page.component';
import { AuthService } from '../../services/auth.service';

describe('Owner login', () => {
  async function render(mode: 'local' | 'oidc', setup = false) {
    const auth = {
      configuration: () => of({ mode, setup_required: setup }),
      login: vi.fn(() => of(void 0)),
      setup: vi.fn(() => of(void 0)),
      startSso: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map() } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LoginPageComponent);
    fixture.detectChanges();
    return { fixture, auth };
  }
  it('shows local login without registration', async () => {
    const { fixture } = await render('local');
    expect(fixture.nativeElement.querySelector('zukan-login-form')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('Register');
  });
  it('shows only SSO for an OIDC installation', async () => {
    const { fixture, auth } = await render('oidc');
    expect(fixture.nativeElement.querySelector('zukan-login-form')).toBeNull();
    fixture.nativeElement.querySelector('button').click();
    expect(auth.startSso).toHaveBeenCalledWith('/');
  });
});
