import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { AlbumAccessRole, AlbumRead } from '../../../models/albums';
import { MediaService } from '../../../services/media.service';
import { AlbumsClientService } from '../../../services/web/albums-client.service';

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
  readonly previewLayout = computed(() => {
    const count = this.visiblePreviewUrls().length;
    if (count >= 4) {
      return 'quad';
    }
    if (count === 3) {
      return 'trio';
    }
    if (count === 2) {
      return 'duo';
    }
    return 'single';
  });

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
  readonly hasExplicitCover = computed(() => {
    const album = this.album();
    const coverMediaId = album.cover_media_id;
    const previewMedia = album.preview_media ?? [];

    if (!coverMediaId) {
      return false;
    }

    if (previewMedia.length === 0) {
      return true;
    }

    return previewMedia[0]?.id !== coverMediaId;
  });

  constructor() {
    effect(() => {
      const album = this.album();
      const targetPreviewCount = this.hasExplicitCover()
        ? 1
        : Math.min(Math.max(album.media_count ?? 0, 0), 4);
      const previewIds = this.previewMediaIds();
      const ids$ = previewIds.length >= targetPreviewCount || targetPreviewCount <= 1
        ? of(previewIds.slice(0, targetPreviewCount))
        : this.albumsClient.listMedia(album.id, { page_size: 4 }).pipe(
            map((page) => {
              const fetchedIds = page.items.map((item) => item.id).slice(0, 4);
              const mergedIds = [
                ...previewIds,
                ...fetchedIds,
              ].filter((id, index, ids) => ids.indexOf(id) === index);
              return mergedIds.length > 0 ? mergedIds.slice(0, targetPreviewCount) : previewIds;
            }),
            catchError(() => of(previewIds)),
          );

      ids$.pipe(
        switchMap((ids) => {
          if (ids.length === 0) {
            return of<string[]>([]);
          }

          return forkJoin(
            ids.map((id) =>
              this.mediaService.getThumbnailUrl(id).pipe(
                catchError(() => of<string | null>(null)),
              ),
            ),
          ).pipe(
            switchMap((urls) => of(urls.filter((url): url is string => !!url))),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe((urls) => {
        this.previewUrls.set(urls);
      });
    });
  }

  private previewMediaIds(): string[] {
    const coverMediaId = this.album().cover_media_id;
    if (coverMediaId && this.hasExplicitCover()) {
      return [coverMediaId];
    }

    const previewMedia = this.album().preview_media ?? [];
    return [
      ...(coverMediaId ? [coverMediaId] : []),
      ...previewMedia.map((item) => item.id),
    ].filter((id, index, ids) => ids.indexOf(id) === index);
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
