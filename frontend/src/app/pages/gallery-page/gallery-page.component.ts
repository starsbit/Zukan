import { AsyncPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { MediaRead } from '../../models/api';
import { MediaService } from '../../services/media.service';
import { GalleryMediaCardComponent } from '../../components/gallery-media-card/gallery-media-card.component';
import { GalleryViewerComponent } from '../../components/gallery-viewer/gallery-viewer.component';

@Component({
  selector: 'app-gallery-page',
  imports: [
    AsyncPipe,
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    GalleryMediaCardComponent,
    GalleryViewerComponent
  ],
  templateUrl: './gallery-page.component.html',
  styleUrl: './gallery-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly mediaService = inject(MediaService);

  readonly items$ = this.mediaService.items$;
  readonly loading$ = this.mediaService.loading$;
  readonly loaded$ = this.mediaService.loaded$;
  readonly error$ = this.mediaService.error$;

  selectedMedia: MediaRead | null = null;

  constructor() {
    this.loadLatestMedia();
  }

  reload(): void {
    this.loadLatestMedia();
  }

  openMedia(media: MediaRead): void {
    this.selectedMedia = media;
  }

  closeMedia(): void {
    this.selectedMedia = null;
  }

  private loadLatestMedia(): void {
    this.mediaService.loadPage({
      page: 1,
      page_size: 60,
      status: 'done'
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          // The template already renders the error state from MediaService.
        }
      });
  }
}
