import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface UrlIngestDialogResult {
  url: string;
  isPublic: boolean;
}

const URL_PATTERN = /^https?:\/\/.+/i;

@Component({
  selector: 'zukan-url-ingest-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
  ],
  templateUrl: './url-ingest-dialog.component.html',
  styleUrl: './url-ingest-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UrlIngestDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<UrlIngestDialogComponent, UrlIngestDialogResult>);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.nonNullable.group({
    url: ['', [Validators.required, Validators.pattern(URL_PATTERN)]],
  });

  protected readonly isPublic = signal(false);

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.dialogRef.close({
      url: this.form.getRawValue().url.trim(),
      isPublic: this.isPublic(),
    });
  }
}
