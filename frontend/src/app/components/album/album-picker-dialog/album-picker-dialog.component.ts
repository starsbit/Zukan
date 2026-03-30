import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlbumStore } from '../../../services/album.store';

export interface AlbumPickerDialogData {
  title: string;
  confirmLabel: string;
  selectedCount: number;
}

export interface AlbumPickerDialogValue {
  albumId: string;
  albumName: string;
}

@Component({
  selector: 'zukan-album-picker-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  templateUrl: './album-picker-dialog.component.html',
  styleUrl: './album-picker-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumPickerDialogComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef<AlbumPickerDialogComponent, AlbumPickerDialogValue>);
  protected readonly data = inject<AlbumPickerDialogData>(MAT_DIALOG_DATA);
  private readonly albumStore = inject(AlbumStore);
  private readonly fb = inject(FormBuilder);

  readonly albums = this.albumStore.items;
  readonly loading = computed(() => this.albumStore.loading() && this.albums().length === 0);
  readonly hasAlbums = computed(() => this.albums().length > 0);

  readonly form = this.fb.nonNullable.group({
    albumId: ['', Validators.required],
  });

  constructor() {
    if (!this.albumStore.loaded()) {
      this.albumStore.load({ sort_by: 'name', sort_order: 'asc' })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe();
    }
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const albumId = this.form.getRawValue().albumId;
    const album = this.albums().find((candidate) => candidate.id === albumId);
    if (!album) {
      return;
    }

    this.dialogRef.close({
      albumId: album.id,
      albumName: album.name,
    });
  }
}
