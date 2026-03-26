import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, SimpleChanges, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { AlbumRead } from '../../models/api';
import { AlbumsClientService } from '../../services/web/albums-client.service';
import { MediaClientService } from '../../services/web/media-client.service';

@Component({
  selector: 'app-album-card',
  imports: [
    MatCardModule,
    MatIconModule,
    RouterLink
  ],
  templateUrl: './album-card.component.html',
  styleUrl: './album-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AlbumCardComponent implements OnChanges, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly albumsClient = inject(AlbumsClientService);
  private readonly mediaClient = inject(MediaClientService);
  private requestId = 0;

  @Input({ required: true }) album!: AlbumRead;

  coverUrls: string[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['album']) {
      this.loadCovers();
    }
  }

  ngOnDestroy(): void {
    this.revokeCoverUrls();
  }

  get showMosaicCover(): boolean {
    return this.coverUrls.length >= 4;
  }

  get primaryCoverUrl(): string | null {
    return this.coverUrls[0] ?? null;
  }

  private loadCovers(): void {
    this.requestId += 1;
    const requestId = this.requestId;
    this.revokeCoverUrls();

    if (this.album.media_count >= 4) {
      this.albumsClient.listAlbumMedia(this.album.id, { page_size: 4 }).subscribe({
        next: (page) => {
          if (requestId !== this.requestId) {
            return;
          }

          const mediaIds = page.items.slice(0, 4).map((item) => item.id);
          if (mediaIds.length < 4) {
            this.loadSingleCover(requestId);
            return;
          }

          forkJoin(mediaIds.map((mediaId) => this.mediaClient.getMediaThumbnail(mediaId))).subscribe({
            next: (blobs) => {
              if (requestId !== this.requestId) {
                return;
              }

              this.coverUrls = blobs.map((blob) => URL.createObjectURL(blob));
              this.cdr.markForCheck();
            },
            error: () => {
              if (requestId !== this.requestId) {
                return;
              }

              this.loadSingleCover(requestId);
            }
          });
        },
        error: () => {
          if (requestId !== this.requestId) {
            return;
          }

          this.loadSingleCover(requestId);
        }
      });
      return;
    }

    this.loadSingleCover(requestId);
  }

  private loadSingleCover(requestId: number): void {
    if (!this.album.cover_media_id) {
      this.cdr.markForCheck();
      return;
    }

    this.mediaClient.getMediaThumbnail(this.album.cover_media_id).subscribe({
      next: (blob) => {
        if (requestId !== this.requestId) {
          return;
        }

        this.coverUrls = [URL.createObjectURL(blob)];
        this.cdr.markForCheck();
      },
      error: () => {
        if (requestId !== this.requestId) {
          return;
        }

        this.coverUrls = [];
        this.cdr.markForCheck();
      }
    });
  }

  private revokeCoverUrls(): void {
    for (const coverUrl of this.coverUrls) {
      URL.revokeObjectURL(coverUrl);
    }
    this.coverUrls = [];
  }
}
