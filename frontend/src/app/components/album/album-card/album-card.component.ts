import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { LazyViewportDirective } from '../../../directives/lazy-viewport.directive';
import { AlbumAccessRole, AlbumRead } from '../../../models/albums';
import { MediaService } from '../../../services/media.service';
import { AlbumsClientService } from '../../../services/web/albums-client.service';
import {
  getAlbumPreviewLayout,
  hasExplicitAlbumCover,
  resolveAlbumPreviewUrls,
} from '../../../utils/album-preview.utils';

@Component({
  selector: 'zukan-album-card',
  imports: [LazyViewportDirective, MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, RouterLink],
  templateUrl: './album-card.component.html',
  styleUrl: './album-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumCardComponent {
  readonly album = input.required<AlbumRead>();
  readonly allowEdit = input(false);
  readonly allowInvite = input(false);
  readonly allowDelete = input(false);

  readonly editRequested = output<AlbumRead>();
  readonly inviteRequested = output<AlbumRead>();
  readonly deleteRequested = output<AlbumRead>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly mediaService = inject(MediaService);
  private readonly albumsClient = inject(AlbumsClientService);
  private lastAlbumId: string | null = null;
  private hasRequestedPreviews = false;

  readonly previewUrls = signal<string[]>([]);
  readonly visiblePreviewUrls = computed(() => this.previewUrls().slice(0, 4));
  readonly previewOverflowCount = computed(() => Math.max(this.previewUrls().length - 4, 0));
  readonly previewLayout = computed(() => getAlbumPreviewLayout(this.visiblePreviewUrls().length));

  readonly accessLabel = computed(() => {
    switch (this.album().access_role) {
      case AlbumAccessRole.OWNER:
        return 'Owner';
      case AlbumAccessRole.EDITOR:
        return 'Can edit';
      default:
        return 'View only';
    }
  });
  readonly ownerName = computed(() => this.album().owner?.username ?? 'Unknown');
  readonly hasExplicitCover = computed(() => hasExplicitAlbumCover(this.album()));

  constructor() {
    effect(() => {
      const album = this.album();
      if (album.id === this.lastAlbumId) {
        return;
      }

      this.lastAlbumId = album.id;
      this.hasRequestedPreviews = false;
      this.previewUrls.set([]);
    });
  }

  onViewportVisible(): void {
    this.loadPreviewUrls();
  }

  onEdit(event: Event): void {
    event.stopPropagation();
    this.editRequested.emit(this.album());
  }

  onDelete(event: Event): void {
    event.stopPropagation();
    this.deleteRequested.emit(this.album());
  }

  onInvite(event: Event): void {
    event.stopPropagation();
    this.inviteRequested.emit(this.album());
  }

  private loadPreviewUrls(): void {
    if (this.hasRequestedPreviews) {
      return;
    }

    const album = this.album();
    this.hasRequestedPreviews = true;
    resolveAlbumPreviewUrls(album, {
      albumsClient: this.albumsClient,
      mediaService: this.mediaService,
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((urls) => {
        if (this.album().id !== album.id) {
          return;
        }
        this.previewUrls.set(urls);
      });
  }
}
