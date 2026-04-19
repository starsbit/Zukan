import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { switchMap, tap } from 'rxjs';
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
  imports: [MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, RouterLink],
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
    toObservable(this.album).pipe(
      tap(() => this.previewUrls.set([])),
      switchMap((album) => resolveAlbumPreviewUrls(album, {
        albumsClient: this.albumsClient,
        mediaService: this.mediaService,
      })),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((urls) => {
      this.previewUrls.set(urls);
    });
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
}
