import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { EMPTY, catchError } from 'rxjs';
import { LazyViewportDirective } from '../../../../directives/lazy-viewport.directive';
import { MediaService } from '../../../../services/media.service';

@Component({
  selector: 'zukan-upload-status-preview',
  standalone: true,
  imports: [LazyViewportDirective, MatIconModule],
  templateUrl: './upload-status-preview.component.html',
  styleUrl: './upload-status-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadStatusPreviewComponent {
  readonly mediaId = input<string | null>(null);

  private readonly destroyRef = inject(DestroyRef);
  private readonly mediaService = inject(MediaService);
  private lastMediaId: string | null = null;
  private hasRequestedPreview = false;

  readonly visible = signal(false);
  readonly previewUrl = signal<string | null>(null);
  readonly failed = signal(false);
  readonly hasPreview = computed(() => !!this.previewUrl() && !this.failed());

  constructor() {
    effect(() => {
      const mediaId = this.mediaId();
      if (mediaId !== this.lastMediaId) {
        this.lastMediaId = mediaId;
        this.hasRequestedPreview = false;
        this.previewUrl.set(null);
        this.failed.set(false);
      }

      if (this.visible()) {
        untracked(() => this.loadPreview(mediaId));
      }
    });
  }

  onViewportVisible(): void {
    this.visible.set(true);
    this.loadPreview(this.mediaId());
  }

  private loadPreview(mediaId: string | null): void {
    if (this.hasRequestedPreview) {
      return;
    }

    if (!mediaId) {
      this.failed.set(true);
      return;
    }

    this.hasRequestedPreview = true;
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
