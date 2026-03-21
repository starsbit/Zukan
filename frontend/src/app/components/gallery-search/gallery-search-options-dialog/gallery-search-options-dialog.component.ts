import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import { GallerySearchFilters } from '../gallery-search.models';
import { createDefaultGallerySearchFilters } from '../gallery-search.utils';

type SearchStatus = GallerySearchFilters['status'][number];

@Component({
  selector: 'app-gallery-search-options-dialog',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatChipsModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule
  ],
  templateUrl: './gallery-search-options-dialog.component.html',
  styleUrl: './gallery-search-options-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GallerySearchOptionsDialogComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<GallerySearchOptionsDialogComponent, GallerySearchFilters>);
  private readonly data = inject<GallerySearchFilters>(MAT_DIALOG_DATA);

  readonly form = this.formBuilder.nonNullable.group({
    favorited: [this.data.favorited],
    nsfw: [this.data.nsfw],
    status: [this.data.status],
    media_type: [this.data.media_type],
    captured_after: [this.data.captured_after ?? ''],
    captured_before: [this.data.captured_before ?? '']
  });

  readonly statusOptions: SearchStatus[] = ['done', 'pending', 'processing', 'failed'];
  readonly mediaTypeOptions: GallerySearchFilters['media_type'][number][] = ['image', 'gif', 'video'];

  clearAll(): void {
    const defaults = createDefaultGallerySearchFilters();
    this.form.setValue({
      favorited: defaults.favorited,
      nsfw: defaults.nsfw,
      status: [...defaults.status],
      media_type: [...defaults.media_type],
      captured_after: '',
      captured_before: ''
    });
  }

  apply(): void {
    const raw = this.form.getRawValue();
    this.dialogRef.close({
      favorited: raw.favorited,
      nsfw: raw.nsfw,
      status: raw.status,
      media_type: raw.media_type,
      captured_after: raw.captured_after || null,
      captured_before: raw.captured_before || null
    });
  }

  toggleStatus(status: SearchStatus): void {
    this.form.controls.status.setValue(toggleValue(this.form.controls.status.getRawValue(), status));
  }

  toggleMediaType(mediaType: GallerySearchFilters['media_type'][number]): void {
    this.form.controls.media_type.setValue(toggleValue(this.form.controls.media_type.getRawValue(), mediaType));
  }
}

function toggleValue<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}
