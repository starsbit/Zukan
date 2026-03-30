import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface AlbumFormDialogData {
  title: string;
  confirmLabel: string;
  initialName?: string;
  initialDescription?: string | null;
}

export interface AlbumFormDialogValue {
  name: string;
  description: string | null;
}

@Component({
  selector: 'zukan-album-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './album-form-dialog.component.html',
  styleUrl: './album-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumFormDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<AlbumFormDialogComponent, AlbumFormDialogValue>);
  protected readonly data = inject<AlbumFormDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.nonNullable.group({
    name: [this.data.initialName ?? '', [Validators.required, Validators.maxLength(255)]],
    description: [this.data.initialDescription ?? '', [Validators.maxLength(1000)]],
  });

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { name, description } = this.form.getRawValue();
    this.dialogRef.close({
      name: name.trim(),
      description: description.trim() || null,
    });
  }
}
