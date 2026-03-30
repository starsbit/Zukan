import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AlbumShareRole } from '../../../models/albums';

export interface AlbumShareDialogData {
  albumName: string;
}

export interface AlbumShareDialogValue {
  username: string;
  role: AlbumShareRole;
}

@Component({
  selector: 'zukan-album-share-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './album-share-dialog.component.html',
  styleUrl: './album-share-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumShareDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<AlbumShareDialogComponent, AlbumShareDialogValue>);
  protected readonly data = inject<AlbumShareDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);

  readonly roles = [
    { value: AlbumShareRole.VIEWER, label: 'Viewer' },
    { value: AlbumShareRole.EDITOR, label: 'Editor' },
  ] as const;

  readonly form = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(64)]],
    role: [AlbumShareRole.VIEWER, [Validators.required]],
  });

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { username, role } = this.form.getRawValue();
    this.dialogRef.close({
      username: username.trim(),
      role,
    });
  }
}
