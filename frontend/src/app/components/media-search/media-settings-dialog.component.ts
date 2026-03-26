import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';

import { UsersService } from '../../services/users.service';

@Component({
  selector: 'app-media-settings-dialog',
  imports: [
    AsyncPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule
  ],
  templateUrl: './media-settings-dialog.component.html',
  styleUrl: './media-settings-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MediaSettingsDialogComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly usersService = inject(UsersService);
  private readonly dialogRef = inject(MatDialogRef<MediaSettingsDialogComponent>);
  private readonly snackBar = inject(MatSnackBar);

  readonly saving$ = this.usersService.loading$;
  readonly profile = this.usersService.snapshot.profile;
  readonly form = this.formBuilder.nonNullable.group({
    show_nsfw: [this.profile?.show_nsfw ?? false],
    tag_confidence_threshold: [
      this.profile?.tag_confidence_threshold ?? 0.35,
      [Validators.min(0), Validators.max(1)]
    ]
  });

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    this.usersService.updateMe({
      show_nsfw: raw.show_nsfw,
      tag_confidence_threshold: Number(raw.tag_confidence_threshold)
    }).subscribe({
      next: () => {
        this.snackBar.open('Settings saved.', 'Close', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: () => {
        this.snackBar.open('Could not save settings. Please try again.', 'Close', { duration: 3000 });
      }
    });
  }
}
