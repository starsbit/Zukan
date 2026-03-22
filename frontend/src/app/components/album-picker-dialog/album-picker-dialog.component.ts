import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';

import { AlbumRead, Uuid } from '../../models/api';

interface AlbumPickerDialogData {
  albums: AlbumRead[];
  selectedCount: number;
}

@Component({
  selector: 'app-album-picker-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule
  ],
  templateUrl: './album-picker-dialog.component.html',
  styleUrl: './album-picker-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AlbumPickerDialogComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<AlbumPickerDialogComponent, Uuid>);
  readonly data = inject<AlbumPickerDialogData>(MAT_DIALOG_DATA);

  readonly form = this.formBuilder.nonNullable.group({
    albumId: ['', Validators.required]
  });

  submit(): void {
    const albumId = this.form.controls.albumId.getRawValue();
    if (!albumId) {
      return;
    }

    this.dialogRef.close(albumId);
  }
}
