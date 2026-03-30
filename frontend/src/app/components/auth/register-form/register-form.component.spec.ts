import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { RegisterFormComponent } from './register-form.component';

describe('RegisterFormComponent', () => {
  it('emits submitted values when the form is valid', async () => {
    await TestBed.configureTestingModule({
      imports: [RegisterFormComponent, NoopAnimationsModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(RegisterFormComponent);
    const component = fixture.componentInstance;
    const emitSpy = vi.spyOn(component.submitted, 'emit');

    component.form.setValue({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password1',
      confirmPassword: 'password1',
    });
    component.onSubmit();

    expect(emitSpy).toHaveBeenCalledWith({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password1',
    });
  });

  it('does not emit when the form is invalid', async () => {
    await TestBed.configureTestingModule({
      imports: [RegisterFormComponent, NoopAnimationsModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(RegisterFormComponent);
    const component = fixture.componentInstance;
    const emitSpy = vi.spyOn(component.submitted, 'emit');

    component.form.setValue({
      username: 'ab',
      email: 'invalid',
      password: 'short',
      confirmPassword: 'different',
    });
    component.onSubmit();

    expect(emitSpy).not.toHaveBeenCalled();
  });
});
