import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AlbumAccessRole, AlbumShareRole } from '../../models/albums';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { AlbumStore } from '../../services/album.store';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { UserStore } from '../../services/user.store';
import { AuthStore } from '../../services/web/auth.store';
import { AlbumComponent } from './album.component';
import { MediaService } from '../../services/media.service';
import { AlbumsClientService } from '../../services/web/albums-client.service';

@Component({
  selector: 'zukan-layout',
  template: '<ng-content></ng-content>',
})
class TestLayoutComponent {}

describe('AlbumComponent', () => {
  it('renders visible albums with owner, access text, and role-based actions', async () => {
    const dialog = {
      open: vi.fn(() => ({ afterClosed: () => of(undefined) })),
    };
    const albumStore = {
      items: () => [
        {
          id: 'a1',
          owner_id: 'u1',
          owner: { id: 'u1', username: 'owner' },
          access_role: AlbumAccessRole.OWNER,
          name: 'Owner album',
          description: 'Owned by you',
          cover_media_id: null,
          preview_media: [],
          media_count: 4,
          version: 1,
          created_at: '2026-03-20T00:00:00Z',
          updated_at: '2026-03-21T00:00:00Z',
        },
        {
          id: 'a2',
          owner_id: 'u2',
          owner: { id: 'u2', username: 'collab' },
          access_role: AlbumAccessRole.VIEWER,
          name: 'Shared album',
          description: 'Read only',
          cover_media_id: null,
          preview_media: [],
          media_count: 2,
          version: 3,
          created_at: '2026-03-18T00:00:00Z',
          updated_at: '2026-03-19T00:00:00Z',
        },
      ],
      loading: () => false,
      isEmpty: () => false,
      load: vi.fn(() => of([])),
      create: vi.fn(() => of({})),
      share: vi.fn(() => of({})),
      update: vi.fn(() => of({})),
      delete: vi.fn(() => of(void 0)),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: MatDialog, useValue: dialog },
        { provide: AlbumStore, useValue: albumStore },
        { provide: AlbumsClientService, useValue: { listMedia: vi.fn(() => of({ items: [] })) } },
        { provide: MediaService, useValue: { getThumbnailUrl: vi.fn(() => of('blob:thumb')) } },
        { provide: ConfirmDialogService, useValue: { open: vi.fn(() => of(true)) } },
        { provide: UserStore, useValue: { isAdmin: () => false } },
      ],
    })
      .overrideComponent(AlbumComponent, {
        remove: { imports: [LayoutComponent] },
        add: { imports: [TestLayoutComponent] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(AlbumComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Create album');
    expect(text).toContain('Owner album');
    expect(text).toContain('Shared album');
    expect(text).toContain('by owner');
    expect(text).toContain('Owner');
    expect(text).toContain('View only');

    const cards = fixture.nativeElement.querySelectorAll('zukan-album-card');
    expect(cards.length).toBe(2);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[aria-label="Edit album"]').length).toBe(1);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[aria-label="Invite to album"]').length).toBe(1);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[aria-label="Delete album"]').length).toBe(1);
    expect(albumStore.load).toHaveBeenCalledTimes(1);
  });

  it('opens the album dialog and creates an album from the page action', async () => {
    const dialog = {
      open: vi.fn(() => ({
        afterClosed: () => of({ name: 'New album', description: 'Fresh photos' }),
      })),
    };
    const albumStore = {
      items: () => [],
      loading: () => false,
      isEmpty: () => true,
      load: vi.fn(() => of([])),
      create: vi.fn(() => of({})),
      share: vi.fn(() => of({})),
      update: vi.fn(() => of({})),
      delete: vi.fn(() => of(void 0)),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: MatDialog, useValue: dialog },
        { provide: AlbumStore, useValue: albumStore },
        { provide: AlbumsClientService, useValue: { listMedia: vi.fn(() => of({ items: [] })) } },
        { provide: MediaService, useValue: { getThumbnailUrl: vi.fn(() => of('blob:thumb')) } },
        { provide: ConfirmDialogService, useValue: { open: vi.fn(() => of(true)) } },
        { provide: UserStore, useValue: { isAdmin: () => false } },
      ],
    })
      .overrideComponent(AlbumComponent, {
        remove: { imports: [LayoutComponent] },
        add: { imports: [TestLayoutComponent] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(AlbumComponent);
    fixture.detectChanges();

    const createButton = (fixture.nativeElement as HTMLElement).querySelector('button');
    expect(createButton?.textContent).toContain('Create album');

    createButton?.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(albumStore.create).toHaveBeenCalledWith({
      name: 'New album',
      description: 'Fresh photos',
    });
  });

  it('opens the invite dialog and shares an album from the page action', async () => {
    const dialog = {
      open: vi.fn(() => ({
        afterClosed: () => of({
          username: 'viewer_user',
          role: AlbumShareRole.EDITOR,
        }),
      })),
    };
    const albumStore = {
      items: () => [
        {
          id: 'a1',
          owner_id: 'u1',
          owner: { id: 'u1', username: 'owner' },
          access_role: AlbumAccessRole.OWNER,
          name: 'Owner album',
          description: 'Owned by you',
          cover_media_id: null,
          preview_media: [],
          media_count: 4,
          version: 1,
          created_at: '2026-03-20T00:00:00Z',
          updated_at: '2026-03-21T00:00:00Z',
        },
      ],
      loading: () => false,
      isEmpty: () => false,
      load: vi.fn(() => of([])),
      create: vi.fn(() => of({})),
      share: vi.fn(() => of({})),
      update: vi.fn(() => of({})),
      delete: vi.fn(() => of(void 0)),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: MatDialog, useValue: dialog },
        { provide: AlbumStore, useValue: albumStore },
        { provide: AlbumsClientService, useValue: { listMedia: vi.fn(() => of({ items: [] })) } },
        { provide: MediaService, useValue: { getThumbnailUrl: vi.fn(() => of('blob:thumb')) } },
        { provide: ConfirmDialogService, useValue: { open: vi.fn(() => of(true)) } },
        { provide: UserStore, useValue: { isAdmin: () => false } },
      ],
    })
      .overrideComponent(AlbumComponent, {
        remove: { imports: [LayoutComponent] },
        add: { imports: [TestLayoutComponent] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(AlbumComponent);
    fixture.detectChanges();

    const inviteButton = (fixture.nativeElement as HTMLElement).querySelector('[aria-label="Invite to album"]');
    inviteButton?.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(albumStore.share).toHaveBeenCalledWith('a1', {
      username: 'viewer_user',
      role: AlbumShareRole.EDITOR,
    });
  });

  it('renders albums without an owner payload using a safe fallback label', async () => {
    const dialog = {
      open: vi.fn(() => ({ afterClosed: () => of(undefined) })),
    };
    const albumStore = {
      items: () => [
        {
          id: 'a1',
          owner_id: 'u1',
          owner: undefined,
          access_role: AlbumAccessRole.OWNER,
          name: 'Recovered album',
          description: null,
          cover_media_id: null,
          preview_media: [],
          media_count: 0,
          version: 1,
          created_at: '2026-03-20T00:00:00Z',
          updated_at: '2026-03-21T00:00:00Z',
        },
      ],
      loading: () => false,
      isEmpty: () => false,
      load: vi.fn(() => of([])),
      create: vi.fn(() => of({})),
      share: vi.fn(() => of({})),
      update: vi.fn(() => of({})),
      delete: vi.fn(() => of(void 0)),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: MatDialog, useValue: dialog },
        { provide: AlbumStore, useValue: albumStore },
        { provide: AlbumsClientService, useValue: { listMedia: vi.fn(() => of({ items: [] })) } },
        { provide: MediaService, useValue: { getThumbnailUrl: vi.fn(() => of('blob:thumb')) } },
        { provide: ConfirmDialogService, useValue: { open: vi.fn(() => of(true)) } },
        { provide: UserStore, useValue: { isAdmin: () => false } },
      ],
    })
      .overrideComponent(AlbumComponent, {
        remove: { imports: [LayoutComponent] },
        add: { imports: [TestLayoutComponent] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(AlbumComponent);

    expect(() => fixture.detectChanges()).not.toThrow();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('by Unknown');
  });

  it('uses cover_media_id as a preview fallback when preview_media is missing', async () => {
    const dialog = {
      open: vi.fn(() => ({ afterClosed: () => of(undefined) })),
    };
    const getThumbnailUrl = vi.fn(() => of('blob:thumb'));
    const albumStore = {
      items: () => [
        {
          id: 'a1',
          owner_id: 'u1',
          owner: undefined,
          access_role: undefined,
          name: 'Recovered album',
          description: null,
          cover_media_id: 'm-cover',
          preview_media: undefined,
          media_count: 8,
          version: 2,
          created_at: '2026-03-20T00:00:00Z',
          updated_at: '2026-03-21T00:00:00Z',
        },
      ],
      loading: () => false,
      isEmpty: () => false,
      load: vi.fn(() => of([])),
      create: vi.fn(() => of({})),
      share: vi.fn(() => of({})),
      update: vi.fn(() => of({})),
      delete: vi.fn(() => of(void 0)),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: MatDialog, useValue: dialog },
        { provide: AlbumStore, useValue: albumStore },
        { provide: AlbumsClientService, useValue: { listMedia: vi.fn(() => of({ items: [] })) } },
        { provide: MediaService, useValue: { getThumbnailUrl } },
        { provide: ConfirmDialogService, useValue: { open: vi.fn(() => of(true)) } },
        { provide: UserStore, useValue: { isAdmin: () => false } },
      ],
    })
      .overrideComponent(AlbumComponent, {
        remove: { imports: [LayoutComponent] },
        add: { imports: [TestLayoutComponent] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(AlbumComponent);
    fixture.detectChanges();

    expect(getThumbnailUrl).toHaveBeenCalledWith('m-cover');
  });
});
