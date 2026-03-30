import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface UploadConfirmDialogData {
  fileCount: number;
}

export interface UploadConfirmDialogResult {
  isPublic: boolean;
}

@Component({
  selector: 'zukan-upload-confirm-dialog',
  imports: [MatButtonModule, MatCheckboxModule, MatDialogModule, MatIconModule, MatTooltipModule],
  templateUrl: './upload-confirm-dialog.component.html',
  styleUrl: './upload-confirm-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadConfirmDialogComponent {
  protected readonly data = inject<UploadConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<UploadConfirmDialogComponent>);

  protected readonly isPublic = signal(false);

  protected confirm(): void {
    this.dialogRef.close({ isPublic: this.isPublic() } satisfies UploadConfirmDialogResult);
  }

  protected cancel(): void {
    this.dialogRef.close();
  }
}
