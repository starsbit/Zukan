import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AlbumAccessRole } from '../models/albums';
import { AlbumStore } from './album.store';
import { UserStore } from './user.store';
import { AlbumsClientService } from './web/albums-client.service';

describe('AlbumStore', () => {
  it('derives owner name and owner access role from the current user for sparse album payloads', async () => {
    const client = {
      list: vi.fn(() => of({
        total: 1,
        next_cursor: null,
        has_more: false,
        page_size: 50,
        items: [
          {
            id: 'album-1',
            owner_id: 'user-1',
            owner: undefined,
            access_role: undefined,
            name: 'Test',
            description: 'desc',
            cover_media_id: null,
            preview_media: undefined,
            media_count: 8,
            version: 2,
            created_at: '2026-03-30T05:29:51.715424Z',
            updated_at: '2026-03-30T05:53:26.390533Z',
          },
        ],
      })),
    };

    await TestBed.configureTestingModule({
      providers: [
        AlbumStore,
        { provide: AlbumsClientService, useValue: client },
        {
          provide: UserStore,
          useValue: {
            currentUser: () => ({
              id: 'user-1',
              username: 'stars',
              email: 'stars@example.com',
              is_admin: false,
              show_nsfw: false,
              tag_confidence_threshold: 0.5,
              version: 1,
              created_at: '2026-03-01T00:00:00Z',
            }),
          },
        },
      ],
    }).compileComponents();

    const store = TestBed.inject(AlbumStore);
    const albums = await new Promise<ReturnType<AlbumStore['items']>>((resolve, reject) => {
      store.load().subscribe({
        next: () => resolve(store.items()),
        error: reject,
      });
    });

    expect(albums).toHaveLength(1);
    expect(albums[0]?.owner.username).toBe('stars');
    expect(albums[0]?.access_role).toBe(AlbumAccessRole.OWNER);
  });

  it('updates preview media when items are added to an existing album', async () => {
    const client = {
      list: vi.fn(() => of({
        total: 1,
        next_cursor: null,
        has_more: false,
        page_size: 50,
        items: [
          {
            id: 'album-1',
            owner_id: 'user-1',
            owner: { id: 'user-1', username: 'stars' },
            access_role: AlbumAccessRole.OWNER,
            name: 'Test',
            description: 'desc',
            cover_media_id: 'cover-1',
            preview_media: [{ id: 'cover-1' }],
            media_count: 1,
            version: 2,
            created_at: '2026-03-30T05:29:51.715424Z',
            updated_at: '2026-03-30T05:53:26.390533Z',
          },
        ],
      })),
      addMedia: vi.fn(() => of({ processed: 3, skipped: 0 })),
    };

    await TestBed.configureTestingModule({
      providers: [
        AlbumStore,
        { provide: AlbumsClientService, useValue: client },
        {
          provide: UserStore,
          useValue: {
            currentUser: () => ({
              id: 'user-1',
              username: 'stars',
              email: 'stars@example.com',
              is_admin: false,
              show_nsfw: false,
              tag_confidence_threshold: 0.5,
              version: 1,
              created_at: '2026-03-01T00:00:00Z',
            }),
          },
        },
      ],
    }).compileComponents();

    const store = TestBed.inject(AlbumStore);

    await new Promise<void>((resolve, reject) => {
      store.load().subscribe({
        next: () => resolve(),
        error: reject,
      });
    });

    await new Promise<void>((resolve, reject) => {
      store.addMedia('album-1', ['m2', 'm3', 'm4']).subscribe({
        next: () => resolve(),
        error: reject,
      });
    });

    const album = store.items()[0];
    expect(album?.media_count).toBe(4);
    expect(album?.preview_media.map((item) => item.id)).toEqual(['cover-1', 'm2', 'm3', 'm4']);
  });
});
