import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LoginPageComponent } from './login-page.component';
import { AuthFormComponent } from '../../components/auth-form/auth-form.component';

@Component({
  selector: 'app-auth-form',
  template: '<div class="stub-auth-form">Auth form</div>',
  standalone: true
})
class StubAuthFormComponent {}

describe('LoginPageComponent', () => {
  let fixture: ComponentFixture<LoginPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginPageComponent]
    })
      .overrideComponent(LoginPageComponent, {
        remove: { imports: [AuthFormComponent] },
        add: { imports: [StubAuthFormComponent] }
      })
      .compileComponents();

    fixture = TestBed.createComponent(LoginPageComponent);
    fixture.detectChanges();
  });

  it('renders the auth form inside the login page shell', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.login-page')).toBeTruthy();
    expect(element.querySelector('app-auth-form')).toBeTruthy();
  });
});
