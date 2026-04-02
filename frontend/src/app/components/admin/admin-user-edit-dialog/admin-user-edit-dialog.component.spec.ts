import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AdminUserEditDialogComponent } from './admin-user-edit-dialog.component';

describe('AdminUserEditDialogComponent', () => {
  const user = {
    id: 'u2',
    username: 'Saber',
    email: 'saber@mail.com',
    is_admin: false,
    show_nsfw: false,
    tag_confidence_threshold: 0.5,
    version: 1,
    created_at: '2026-04-02T00:00:00Z',
    media_count: 12,
    storage_used_bytes: 2048,
  };

  it('enables Save Changes when username or admin status changes', async () => {
    await TestBed.configureTestingModule({
      imports: [AdminUserEditDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { user, currentUserId: 'admin-user' } },
        { provide: MatDialogRef, useValue: { close: () => undefined } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AdminUserEditDialogComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const saveButton = host.querySelector('button[color="primary"]') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    fixture.componentInstance.form.controls.isAdmin.setValue(true);
    fixture.detectChanges();
    expect(saveButton.disabled).toBe(false);

    fixture.componentInstance.form.controls.isAdmin.setValue(false);
    fixture.componentInstance.form.controls.username.setValue('SaberRenamed');
    fixture.detectChanges();
    expect(saveButton.disabled).toBe(false);
  });
});
