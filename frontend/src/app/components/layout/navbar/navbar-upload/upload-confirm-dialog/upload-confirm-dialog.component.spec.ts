import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { UploadConfirmDialogComponent } from './upload-confirm-dialog.component';

async function createComponent(fileCount = 3) {
  const close = vi.fn();
  await TestBed.configureTestingModule({
    imports: [UploadConfirmDialogComponent, NoopAnimationsModule],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { fileCount } },
      { provide: MatDialogRef, useValue: { close } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(UploadConfirmDialogComponent);
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  return { fixture, el, close };
}

describe('UploadConfirmDialogComponent', () => {
  it('shows the file count in singular', async () => {
    const { el } = await createComponent(1);
    expect(el.textContent).toContain('1 file selected');
  });

  it('shows the file count in plural', async () => {
    const { el } = await createComponent(5);
    expect(el.textContent).toContain('5 files selected');
  });

  it('renders the public checkbox unchecked by default', async () => {
    const { el } = await createComponent();
    const checkbox = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(false);
  });

  it('renders the info icon', async () => {
    const { el } = await createComponent();
    const icon = el.querySelector('mat-icon.info-icon');
    expect(icon).not.toBeNull();
  });

  it('confirm() closes with isPublic=false when checkbox is unchecked', async () => {
    const { fixture, close } = await createComponent();
    const component = fixture.componentInstance as InstanceType<typeof UploadConfirmDialogComponent> & {
      confirm: () => void;
    };

    component['confirm']();

    expect(close).toHaveBeenCalledWith({ isPublic: false });
  });

  it('confirm() closes with isPublic=true after checking the checkbox', async () => {
    const { fixture, el, close } = await createComponent();
    const component = fixture.componentInstance as InstanceType<typeof UploadConfirmDialogComponent> & {
      isPublic: { set: (v: boolean) => void };
      confirm: () => void;
    };

    const checkbox = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
    checkbox?.click();
    fixture.detectChanges();

    component['confirm']();

    expect(close).toHaveBeenCalledWith({ isPublic: true });
  });

  it('cancel() closes with no value', async () => {
    const { fixture, close } = await createComponent();
    const component = fixture.componentInstance as InstanceType<typeof UploadConfirmDialogComponent> & {
      cancel: () => void;
    };

    component['cancel']();

    expect(close).toHaveBeenCalledWith();
  });

  it('Upload button calls confirm()', async () => {
    const { el, close } = await createComponent();
    const uploadBtn = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Upload',
    );

    uploadBtn?.click();

    expect(close).toHaveBeenCalledWith({ isPublic: false });
  });

  it('Cancel button calls cancel()', async () => {
    const { el, close } = await createComponent();
    const cancelBtn = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel',
    );

    cancelBtn?.click();

    expect(close).toHaveBeenCalledWith();
  });
});
