import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { EMPTY, catchError } from 'rxjs';
import { MediaService } from '../../../../services/media.service';

@Component({
  selector: 'zukan-upload-status-preview',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './upload-status-preview.component.html',
  styleUrl: './upload-status-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadStatusPreviewComponent {
  readonly mediaId = input<string | null>(null);

  private readonly destroyRef = inject(DestroyRef);
  private readonly mediaService = inject(MediaService);

  readonly previewUrl = signal<string | null>(null);
  readonly failed = signal(false);
  readonly hasPreview = computed(() => !!this.previewUrl() && !this.failed());

  constructor() {
    effect(() => {
      this.loadPreview(this.mediaId());
    });
  }

  private loadPreview(mediaId: string | null): void {
    this.previewUrl.set(null);
    this.failed.set(false);

    if (!mediaId) {
      this.failed.set(true);
      return;
    }

    this.mediaService.getThumbnailUrl(mediaId)
      .pipe(
        catchError(() => this.mediaService.getPosterUrl(mediaId)),
        catchError(() => {
          this.failed.set(true);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((url) => {
        this.previewUrl.set(url);
      });
  }
}
