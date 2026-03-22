import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface AlbumFormDialogValue {
  name: string;
  description: string | null;
}

interface AlbumFormDialogData {
  title: string;
  confirmLabel: string;
  initialName?: string;
  initialDescription?: string | null;
}

@Component({
  selector: 'app-album-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormFieldModule,
    MatInputModule
  ],
  templateUrl: './album-form-dialog.component.html',
  styleUrl: './album-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AlbumFormDialogComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<AlbumFormDialogComponent, AlbumFormDialogValue>);
  readonly data = inject<AlbumFormDialogData>(MAT_DIALOG_DATA);

  readonly form = this.formBuilder.nonNullable.group({
    name: [this.data.initialName ?? '', [Validators.required, Validators.maxLength(255)]],
    description: [this.data.initialDescription ?? '', [Validators.maxLength(1000)]]
  });

  submit(): void {
    const name = this.form.controls.name.getRawValue().trim();
    if (!name) {
      this.form.controls.name.markAsTouched();
      return;
    }

    const description = this.form.controls.description.getRawValue().trim();
    this.dialogRef.close({
      name,
      description: description || null
    });
  }
}
