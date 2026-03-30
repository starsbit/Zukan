import { computed, inject, Injectable, signal } from '@angular/core';
import { finalize, map, Observable, tap } from 'rxjs';
import { AlbumAccessRole, AlbumCreate, AlbumRead, AlbumShareCreate, AlbumShareRead, AlbumUpdate } from '../models/albums';
import { BulkResult } from '../models/common';
import { AlbumsClientService, AlbumListParams } from './web/albums-client.service';
import { UserStore } from './user.store';

@Injectable({ providedIn: 'root' })
export class AlbumStore {
  private readonly client = inject(AlbumsClientService);
  private readonly userStore = inject(UserStore);

  private readonly _items = signal<AlbumRead[]>([]);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);
  private readonly _selectedAlbum = signal<AlbumRead | null>(null);
  private readonly _selectedAlbumLoading = signal(false);

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly selectedAlbum = this._selectedAlbum.asReadonly();
  readonly selectedAlbumLoading = this._selectedAlbumLoading.asReadonly();
  readonly isEmpty = computed(() => this._loaded() && !this._loading() && this._items().length === 0);

  load(params: AlbumListParams = {}): Observable<AlbumRead[]> {
    this._loading.set(true);
    return this.client.list(params).pipe(
      tap((page) => {
        this._items.set(page.items.map((album) => this.normalizeAlbum(album)));
        this._loaded.set(true);
      }),
      map((page) => page.items.map((album) => this.normalizeAlbum(album))),
      finalize(() => this._loading.set(false)),
    );
  }

  get(id: string): Observable<AlbumRead> {
    this._selectedAlbumLoading.set(true);
    return this.client.get(id).pipe(
      tap((album) => {
        const normalized = this.normalizeAlbum(album);
        this._selectedAlbum.set(normalized);
        this.upsert(normalized);
      }),
      finalize(() => this._selectedAlbumLoading.set(false)),
    );
  }

  create(body: AlbumCreate): Observable<AlbumRead> {
    this._selectedAlbumLoading.set(true);
    return this.client.create(body).pipe(
      tap((album) => {
        const normalized = this.normalizeAlbum(album);
        this._selectedAlbum.set(normalized);
        this.upsert(normalized);
      }),
      finalize(() => this._selectedAlbumLoading.set(false)),
    );
  }

  update(id: string, body: AlbumUpdate): Observable<AlbumRead> {
    this._selectedAlbumLoading.set(true);
    return this.client.update(id, body).pipe(
      tap((album) => {
        const normalized = this.normalizeAlbum(album);
        this._selectedAlbum.set(normalized);
        this.upsert(normalized);
      }),
      finalize(() => this._selectedAlbumLoading.set(false)),
    );
  }

  share(id: string, body: AlbumShareCreate): Observable<AlbumShareRead> {
    this._selectedAlbumLoading.set(true);
    return this.client.share(id, body).pipe(
      finalize(() => this._selectedAlbumLoading.set(false)),
    );
  }

  addMedia(id: string, mediaIds: string[]): Observable<BulkResult> {
    this._selectedAlbumLoading.set(true);
    return this.client.addMedia(id, { media_ids: mediaIds }).pipe(
      tap((result) => {
        if (result.processed > 0) {
          this.adjustAlbumAfterAdd(id, mediaIds, result.processed);
        }
      }),
      finalize(() => this._selectedAlbumLoading.set(false)),
    );
  }

  delete(id: string): Observable<void> {
    this._selectedAlbumLoading.set(true);
    return this.client.delete(id).pipe(
      tap(() => {
        this._items.update((items) => items.filter((album) => album.id !== id));
        if (this._selectedAlbum()?.id === id) {
          this._selectedAlbum.set(null);
        }
      }),
      finalize(() => this._selectedAlbumLoading.set(false)),
    );
  }

  private upsert(album: AlbumRead): void {
    this._items.update((items) =>
      items.some((candidate) => candidate.id === album.id)
        ? items.map((candidate) => candidate.id === album.id ? album : candidate)
        : [album, ...items],
    );
  }

  private adjustMediaCount(id: string, delta: number): void {
    if (delta === 0) {
      return;
    }

    this._items.update((items) => items.map((album) =>
      album.id === id
        ? {
            ...album,
            media_count: Math.max(0, album.media_count + delta),
          }
        : album,
    ));

    const selectedAlbum = this._selectedAlbum();
    if (selectedAlbum?.id === id) {
      this._selectedAlbum.set({
        ...selectedAlbum,
        media_count: Math.max(0, selectedAlbum.media_count + delta),
      });
    }
  }

  private adjustAlbumAfterAdd(id: string, mediaIds: string[], processedCount: number): void {
    const addedPreviewMedia = mediaIds.slice(0, processedCount).map((mediaId) => ({ id: mediaId }));

    this._items.update((items) => items.map((album) =>
      album.id === id
        ? this.mergePreviewMedia({
            ...album,
            media_count: Math.max(0, album.media_count + processedCount),
          }, addedPreviewMedia)
        : album,
    ));

    const selectedAlbum = this._selectedAlbum();
    if (selectedAlbum?.id === id) {
      this._selectedAlbum.set(this.mergePreviewMedia({
        ...selectedAlbum,
        media_count: Math.max(0, selectedAlbum.media_count + processedCount),
      }, addedPreviewMedia));
    }
  }

  private mergePreviewMedia(album: AlbumRead, addedPreviewMedia: { id: string }[]): AlbumRead {
    const currentPreviewMedia = album.preview_media ?? [];
    const dedupedPreviewMedia = [
      ...currentPreviewMedia,
      ...addedPreviewMedia,
    ].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, 4);

    return {
      ...album,
      cover_media_id: album.cover_media_id ?? addedPreviewMedia[0]?.id ?? null,
      preview_media: dedupedPreviewMedia,
    };
  }

  private normalizeAlbum(album: AlbumRead): AlbumRead {
    const currentUser = this.userStore.currentUser();
    const isOwner = !!currentUser && currentUser.id === album.owner_id;
    const previewMedia = album.preview_media ?? (
      album.cover_media_id
        ? [{ id: album.cover_media_id }]
        : []
    );
    const owner = album.owner ?? {
      id: album.owner_id ?? currentUser?.id ?? '',
      username: isOwner ? currentUser.username : 'Unknown',
    };
    const accessRole = album.access_role ?? (
      isOwner
        ? AlbumAccessRole.OWNER
        : AlbumAccessRole.VIEWER
    );

    return {
      ...album,
      owner,
      access_role: accessRole,
      preview_media: previewMedia,
      media_count: album.media_count ?? 0,
      description: album.description ?? null,
      cover_media_id: album.cover_media_id ?? null,
    };
  }
}
