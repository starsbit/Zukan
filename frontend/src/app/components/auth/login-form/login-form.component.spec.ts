import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { LoginFormComponent } from './login-form.component';

describe('LoginFormComponent', () => {
  it('emits submitted credentials when the form is valid', async () => {
    await TestBed.configureTestingModule({
      imports: [LoginFormComponent, NoopAnimationsModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginFormComponent);
    const component = fixture.componentInstance;
    const emitSpy = vi.spyOn(component.submitted, 'emit');

    component.form.setValue({ username: 'alice', password: 'secret', rememberMe: true });
    component.onSubmit();

    expect(emitSpy).toHaveBeenCalledWith({
      username: 'alice',
      password: 'secret',
      rememberMe: true,
    });
  });

  it('clears an existing error before emitting on submit', async () => {
    await TestBed.configureTestingModule({
      imports: [LoginFormComponent, NoopAnimationsModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginFormComponent);
    const component = fixture.componentInstance;
    const emitSpy = vi.spyOn(component.submitted, 'emit');

    component.setError('Invalid credentials');
    component.form.setValue({ username: 'alice', password: 'secret', rememberMe: false });

    component.onSubmit();

    expect(component.error()).toBeNull();
    expect(emitSpy).toHaveBeenCalledWith({
      username: 'alice',
      password: 'secret',
      rememberMe: false,
    });
  });
});
