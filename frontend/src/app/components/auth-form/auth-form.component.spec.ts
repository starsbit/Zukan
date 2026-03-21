import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject, throwError } from 'rxjs';

import { AuthFormComponent } from './auth-form.component';
import { AuthService } from '../../services/auth.service';

describe('AuthFormComponent', () => {
  let fixture: ComponentFixture<AuthFormComponent>;
  let component: AuthFormComponent;
  let authService: { login: ReturnType<typeof vi.fn>; register: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authService = {
      login: vi.fn(),
      register: vi.fn()
    };
    router = {
      navigate: vi.fn().mockResolvedValue(true)
    };
    snackBar = {
      open: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [AuthFormComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router },
        { provide: MatSnackBar, useValue: snackBar }
      ]
    })
      .overrideProvider(AuthService, { useValue: authService })
      .overrideProvider(Router, { useValue: router })
      .overrideProvider(MatSnackBar, { useValue: snackBar })
      .compileComponents();

    fixture = TestBed.createComponent(AuthFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('blocks login submission when the form is invalid and marks controls as touched', () => {
    component.login();

    expect(authService.login).not.toHaveBeenCalled();
    expect(component.loginForm.controls.username.touched).toBe(true);
    expect(component.loginForm.controls.password.touched).toBe(true);
  });

  it('logs in successfully and navigates to the gallery', () => {
    authService.login.mockReturnValue(of({ id: 'user-1' }));
    component.loginForm.setValue({
      username: 'fox',
      password: 'supersecret',
      rememberMe: true
    });

    component.login();

    expect(authService.login).toHaveBeenCalledWith({
      username: 'fox',
      password: 'supersecret',
      remember_me: true
    });
    expect(snackBar.open).toHaveBeenCalledWith('Welcome back.', 'Close', { duration: 3000 });
    expect(router.navigate).toHaveBeenCalledWith(['/gallery']);
    expect(component.submittingLogin).toBe(false);
  });

  it('shows an error snackbar when login fails', () => {
    authService.login.mockReturnValue(throwError(() => new Error('bad credentials')));
    component.loginForm.setValue({
      username: 'fox',
      password: 'wrong-password',
      rememberMe: false
    });

    component.login();

    expect(snackBar.open).toHaveBeenCalledWith('Login failed. Please check your credentials.', 'Close', { duration: 3000 });
    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.submittingLogin).toBe(false);
  });

  it('keeps the confirm password validator in sync with the password field', () => {
    component.registerForm.controls.password.setValue('password-1');
    component.registerForm.controls.confirmPassword.setValue('password-2');
    expect(component.registerForm.controls.confirmPassword.hasError('fieldMismatch')).toBe(true);

    component.registerForm.controls.password.setValue('password-2');

    expect(component.registerForm.controls.confirmPassword.hasError('fieldMismatch')).toBe(false);
  });

  it('registers successfully and navigates to the gallery', () => {
    authService.register.mockReturnValue(of({ id: 'user-1' }));
    component.registerForm.setValue({
      username: 'fox',
      email: 'fox@example.com',
      password: 'password-123',
      confirmPassword: 'password-123'
    });

    component.register();

    expect(authService.register).toHaveBeenCalledWith({
      username: 'fox',
      email: 'fox@example.com',
      password: 'password-123'
    });
    expect(snackBar.open).toHaveBeenCalledWith('Account created.', 'Close', { duration: 3000 });
    expect(router.navigate).toHaveBeenCalledWith(['/gallery']);
    expect(component.submittingRegister).toBe(false);
  });

  it('shows an error snackbar when registration fails', () => {
    authService.register.mockReturnValue(throwError(() => new Error('broken')));
    component.registerForm.setValue({
      username: 'fox',
      email: 'fox@example.com',
      password: 'password-123',
      confirmPassword: 'password-123'
    });

    component.register();

    expect(snackBar.open).toHaveBeenCalledWith('Registration failed. Please try again.', 'Close', { duration: 3000 });
    expect(component.submittingRegister).toBe(false);
  });

  it('does not start a registration while another submit is already pending', () => {
    const loginRequest = new Subject<unknown>();
    authService.login.mockReturnValue(loginRequest.asObservable());
    component.loginForm.setValue({
      username: 'fox',
      password: 'supersecret',
      rememberMe: true
    });

    component.login();
    component.register();

    expect(component.submittingLogin).toBe(true);
    expect(authService.register).not.toHaveBeenCalled();

    loginRequest.next({});
    loginRequest.complete();
  });
});
