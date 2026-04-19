import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { AlbumRead } from '../models/albums';
import { MediaService } from '../services/media.service';
import { AlbumsClientService } from '../services/web/albums-client.service';

export type AlbumPreviewLayout = 'single' | 'duo' | 'trio' | 'quad';

export function hasExplicitAlbumCover(album: AlbumRead | null | undefined): boolean {
  if (!album?.cover_media_id) {
    return false;
  }

  const previewMedia = album.preview_media ?? [];
  if (previewMedia.length === 0) {
    return true;
  }

  return previewMedia[0]?.id !== album.cover_media_id;
}

export function getAlbumPreviewLayout(previewCount: number): AlbumPreviewLayout {
  if (previewCount >= 4) {
    return 'quad';
  }
  if (previewCount === 3) {
    return 'trio';
  }
  if (previewCount === 2) {
    return 'duo';
  }
  return 'single';
}

export function getAlbumPreviewTargetCount(album: AlbumRead): number {
  if (hasExplicitAlbumCover(album)) {
    return 1;
  }

  return Math.min(Math.max(album.media_count ?? 0, 0), 4);
}

export function getAlbumPreviewSeedIds(album: AlbumRead): string[] {
  const coverMediaId = album.cover_media_id;
  if (coverMediaId && hasExplicitAlbumCover(album)) {
    return [coverMediaId];
  }

  const previewMedia = album.preview_media ?? [];
  return dedupeIds([
    ...(coverMediaId ? [coverMediaId] : []),
    ...previewMedia.map((item) => item.id),
  ]);
}

export function resolveAlbumPreviewIds(
  album: AlbumRead,
  albumsClient: Pick<AlbumsClientService, 'listMedia'>,
): Observable<string[]> {
  const targetPreviewCount = getAlbumPreviewTargetCount(album);
  const seedIds = getAlbumPreviewSeedIds(album);

  if (seedIds.length >= targetPreviewCount || targetPreviewCount <= 1) {
    return of(seedIds.slice(0, targetPreviewCount));
  }

  return albumsClient.listMedia(album.id, { page_size: 4 }).pipe(
    map((page) => {
      const fetchedIds = page.items.map((item) => item.id).slice(0, 4);
      const mergedIds = dedupeIds([
        ...seedIds,
        ...fetchedIds,
      ]);
      return mergedIds.length > 0
        ? mergedIds.slice(0, targetPreviewCount)
        : seedIds.slice(0, targetPreviewCount);
    }),
    catchError(() => of(seedIds.slice(0, targetPreviewCount))),
  );
}

export function resolveAlbumPreviewUrls(
  album: AlbumRead,
  deps: {
    albumsClient: Pick<AlbumsClientService, 'listMedia'>;
    mediaService: Pick<MediaService, 'getThumbnailUrl'>;
  },
): Observable<string[]> {
  return resolveAlbumPreviewIds(album, deps.albumsClient).pipe(
    switchMap((ids) => {
      if (ids.length === 0) {
        return of<string[]>([]);
      }

      return forkJoin(
        ids.map((id) => deps.mediaService.getThumbnailUrl(id).pipe(
          catchError(() => of<string | null>(null)),
        )),
      ).pipe(
        map((urls) => urls.filter((url): url is string => !!url)),
      );
    }),
  );
}

function dedupeIds(ids: string[]): string[] {
  return ids.filter((id, index, values) => values.indexOf(id) === index);
}
