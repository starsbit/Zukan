import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface RenameDialogData {
  title: string;
  label: string;
  initialName: string;
  maxLength: number;
}

@Component({
  selector: 'zukan-rename-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './rename-dialog.component.html',
  styleUrl: './rename-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RenameDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<RenameDialogComponent, string | null>);
  protected readonly data = inject<RenameDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.nonNullable.group({
    name: [this.data.initialName, [Validators.required, Validators.maxLength(this.data.maxLength)]],
  });

  save(): void {
    const name = this.form.getRawValue().name.trim();
    if (this.form.invalid || !name) {
      this.form.markAllAsTouched();
      return;
    }

    this.dialogRef.close(name);
  }
}
