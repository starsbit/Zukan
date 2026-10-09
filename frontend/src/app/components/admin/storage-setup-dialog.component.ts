import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { API_BASE_URL } from '../../services/web/api.config';

@Component({
  selector: 'zukan-storage-setup-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Choose your media folder</h2>
    <mat-dialog-content>
      <p>Zukan now supports a media folder on your computer or NAS. Your installation has not confirmed which folder to use yet.</p>
      <p>Current folder: <strong>{{ data.root }}</strong></p>
      <p>You can keep this folder or select another in Admin → Storage. Moving your library preserves its images and metadata.</p>
      @if (error()) { <p role="alert">{{ error() }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [disabled]="saving()" (click)="dialogRef.close('later')">Later</button>
      <button mat-stroked-button [disabled]="saving()" (click)="keepCurrentFolder()">Keep current folder</button>
      <button mat-flat-button [disabled]="saving()" (click)="dialogRef.close('settings')">Open storage settings</button>
    </mat-dialog-actions>
  `,
  styles: [`strong { overflow-wrap: anywhere; }`],
})
export class StorageSetupDialogComponent {
  readonly data = inject<{root: string}>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<StorageSetupDialogComponent>);
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  keepCurrentFolder() {
    this.saving.set(true); this.error.set(null); this.dialogRef.disableClose = true;
    this.http.post(`${this.base}/api/v1/admin/storage/confirm`, {root: this.data.root}).subscribe({
      next: () => this.dialogRef.close('confirmed'),
      error: e => {
        this.saving.set(false); this.dialogRef.disableClose = false;
        this.error.set(typeof e.error?.detail === 'string' ? e.error.detail : 'Unable to confirm the folder. Please try again.');
      },
    });
  }
}
