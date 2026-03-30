import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { SetupWizardComponent } from './setup-wizard.component';

describe('SetupWizardComponent', () => {
  it('emits submitted values when the credentials form is valid', async () => {
    await TestBed.configureTestingModule({
      imports: [SetupWizardComponent, NoopAnimationsModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(SetupWizardComponent);
    const component = fixture.componentInstance;
    const emitSpy = vi.spyOn(component.submitted, 'emit');

    component.credentialsForm.setValue({
      username: 'admin',
      email: 'admin@example.com',
      password: 'password1',
      confirmPassword: 'password1',
    });
    component.onSubmit();

    expect(emitSpy).toHaveBeenCalledWith({
      username: 'admin',
      email: 'admin@example.com',
      password: 'password1',
    });
  });

  it('does not emit while loading', async () => {
    await TestBed.configureTestingModule({
      imports: [SetupWizardComponent, NoopAnimationsModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(SetupWizardComponent);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const emitSpy = vi.spyOn(component.submitted, 'emit');

    component.credentialsForm.setValue({
      username: 'admin',
      email: 'admin@example.com',
      password: 'password1',
      confirmPassword: 'password1',
    });
    component.onSubmit();

    expect(emitSpy).not.toHaveBeenCalled();
  });
});
