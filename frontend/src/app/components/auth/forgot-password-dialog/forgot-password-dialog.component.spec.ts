import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ForgotPasswordDialogComponent } from './forgot-password-dialog.component';

describe('ForgotPasswordDialogComponent', () => {
  it('renders reset guidance', async () => {
    await TestBed.configureTestingModule({
      imports: [ForgotPasswordDialogComponent, NoopAnimationsModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(ForgotPasswordDialogComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Password Reset');
  });
});
