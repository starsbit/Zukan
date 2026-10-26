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

    expect(close).toHaveBeenCalledWith({});
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
