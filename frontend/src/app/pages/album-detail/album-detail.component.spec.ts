import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { MediaListState } from '../../models/media';
import { AlbumStore } from '../../services/album.store';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { GalleryStore } from '../../services/gallery.store';
import { MediaService } from '../../services/media.service';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { UserStore } from '../../services/user.store';
import { AlbumsClientService } from '../../services/web/albums-client.service';
import { AuthStore } from '../../services/web/auth.store';
import { AlbumDetailComponent } from './album-detail.component';

@Component({
  selector: 'zukan-layout',
  template: '<ng-content></ng-content>',
})
class TestLayoutComponent {}

function createAlbumsClient() {
  return {
    listMedia: vi.fn((albumId: string) => of({
      items: [
        { id: `${albumId}-preview` },
        { id: `${albumId}-preview-2` },
        { id: `${albumId}-preview-3` },
        { id: `${albumId}-preview-4` },
      ],
    })),
  };
}

describe('AlbumDetailComponent', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not repeatedly reload an empty album result', async () => {
    const albumsClient = createAlbumsClient();
    const dialog = {
      open: vi.fn(() => ({ afterClosed: () => of(undefined) })),
    };
    const routeParamMap = new BehaviorSubject(convertToParamMap({ albumId: 'album-empty' }));
    const paramsState = signal<Record<string, unknown>>({});
    const groupedByDay = signal([]);
    const timeline = signal([]);
    const loading = signal(false);
    const hasMore = signal(false);
    const galleryStore = {
      setParams: vi.fn((params: Record<string, unknown>) => {
        paramsState.set(params);
      }),
      loadInitial: vi.fn(() => {
        paramsState();
        loading.set(false);
        return of({ timeline: { buckets: [] }, page: null });
      }),
      load: vi.fn(() => {
        paramsState();
        loading.set(true);
        return of({
          items: [],
          total: 0,
          next_cursor: null,
          has_more: false,
          page_size: 20,
        }).pipe();
      }),
      loadTimeline: vi.fn(() => {
        paramsState();
        loading.set(false);
        return of({ buckets: [] });
      }),
      loadMore: vi.fn(() =>
        of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 }),
      ),
      clearOptimisticItems: vi.fn(),
      groupedByDay: () => groupedByDay(),
      timeline: () => timeline(),
      loading: () => loading(),
      hasMore: () => hasMore(),
    };
    const albumStore = {
      selectedAlbum: () => ({
        id: 'album-empty',
        name: 'Empty album',
        description: null,
        cover_media_id: null,
        preview_media: [],
        media_count: 0,
        version: 1,
        created_at: '2026-03-20T00:00:00Z',
        updated_at: '2026-03-21T00:00:00Z',
      }),
      selectedAlbumLoading: () => false,
      get: vi.fn(() => of({})),
      share: vi.fn(() => of({})),
      update: vi.fn(() => of({})),
      delete: vi.fn(() => of(void 0)),
    };
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      upload: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ albumId: 'album-empty' }) },
            paramMap: routeParamMap,
            queryParamMap: of(convertToParamMap({})),
          },
        },
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: MatDialog, useValue: dialog },
        { provide: AlbumStore, useValue: albumStore },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: MediaService, useValue: mediaService },
        { provide: AlbumsClientService, useValue: albumsClient },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: NavbarSearchService, useValue: { appliedParams: () => ({}) } },
        { provide: ConfirmDialogService, useValue: { open: vi.fn(() => of(true)) } },
        { provide: UserStore, useValue: { currentUser: () => null } },
      ],
    })
      .overrideComponent(AlbumDetailComponent, {
        remove: { imports: [LayoutComponent] },
        add: { imports: [TestLayoutComponent] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(AlbumDetailComponent);
    fixture.detectChanges();
    routeParamMap.next(convertToParamMap({ albumId: 'album-empty' }));
    await fixture.whenStable();

    expect(galleryStore.loadInitial).toHaveBeenCalledTimes(1);
    expect(galleryStore.load).not.toHaveBeenCalled();
    expect(galleryStore.loadTimeline).not.toHaveBeenCalled();
    expect(galleryStore.loadMore).not.toHaveBeenCalled();
  });

  it('renders the same multi-thumbnail header grid as album cards when multiple previews are available', async () => {
    const albumsClient = createAlbumsClient();
    const galleryStore = {
      setParams: vi.fn(),
      loadInitial: vi.fn(() => of({ timeline: { buckets: [] }, page: null })),
      load: vi.fn(() =>
        of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 }),
      ),
      loadTimeline: vi.fn(() => of({ buckets: [] })),
      loadMore: vi.fn(() =>
        of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 }),
      ),
      clearOptimisticItems: vi.fn(),
      groupedByDay: () => [],
      timeline: () => [],
      loading: () => false,
      hasMore: () => false,
    };
    const albumStore = {
      selectedAlbum: () => ({
        id: 'album-1',
        name: 'Team album',
        description: 'Shared work',
        cover_media_id: null,
        preview_media: [{ id: 'album-1-preview' }],
        media_count: 4,
        version: 2,
        created_at: '2026-03-20T00:00:00Z',
        updated_at: '2026-03-21T00:00:00Z',
      }),
      selectedAlbumLoading: () => false,
      get: vi.fn(() => of({})),
      share: vi.fn(() => of({})),
      update: vi.fn(() => of({})),
      delete: vi.fn(() => of(void 0)),
    };
    const mediaService = {
      getThumbnailUrl: vi.fn((id: string) => of(`blob:${id}`)),
      upload: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ albumId: 'album-1' }) },
            paramMap: of(convertToParamMap({ albumId: 'album-1' })),
            queryParamMap: of(convertToParamMap({})),
          },
        },
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: AlbumStore, useValue: albumStore },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: MediaService, useValue: mediaService },
        { provide: AlbumsClientService, useValue: albumsClient },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: NavbarSearchService, useValue: { appliedParams: () => ({}) } },
        { provide: ConfirmDialogService, useValue: { open: vi.fn(() => of(true)) } },
        { provide: UserStore, useValue: { isAdmin: () => false } },
      ],
    })
      .overrideComponent(AlbumDetailComponent, {
        remove: { imports: [LayoutComponent] },
        add: { imports: [TestLayoutComponent] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(AlbumDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const previewGrid = element.querySelector('.album-detail__preview-grid');
    const previewTiles = element.querySelectorAll('.album-detail__preview-tile');

    expect(albumsClient.listMedia).toHaveBeenCalledWith('album-1', { page_size: 4 });
    expect(previewGrid?.getAttribute('data-layout')).toBe('quad');
    expect(previewTiles.length).toBe(4);
  });

  it('shows the thumbnail action for editable albums and updates the cover from an existing album image', async () => {
    const albumsClient = createAlbumsClient();
    const dialog = {
      open: vi.fn(() => ({
        afterClosed: () => of({ coverMediaId: 'media-2' }),
      })),
    };
    const galleryStore = {
      setParams: vi.fn(),
      loadInitial: vi.fn(() => of({ timeline: { buckets: [] }, page: null })),
      load: vi.fn(() =>
        of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 }),
      ),
      loadTimeline: vi.fn(() => of({ buckets: [] })),
      loadMore: vi.fn(() =>
        of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 }),
      ),
      clearOptimisticItems: vi.fn(),
      groupedByDay: () => [],
      timeline: () => [],
      loading: () => false,
      hasMore: () => false,
    };
    const albumStore = {
      selectedAlbum: () => ({
        id: 'album-1',
        name: 'Team album',
        description: 'Shared work',
        cover_media_id: 'media-1',
        preview_media: [{ id: 'album-1-preview' }],
        media_count: 3,
        version: 2,
        created_at: '2026-03-20T00:00:00Z',
        updated_at: '2026-03-21T00:00:00Z',
      }),
      selectedAlbumLoading: () => false,
      get: vi.fn(() => of({})),
      share: vi.fn(() => of({})),
      update: vi.fn(() => of({})),
      delete: vi.fn(() => of(void 0)),
    };
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      upload: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ albumId: 'album-1' }) },
            paramMap: of(convertToParamMap({ albumId: 'album-1' })),
            queryParamMap: of(convertToParamMap({})),
          },
        },
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: MatDialog, useValue: dialog },
        { provide: AlbumStore, useValue: albumStore },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: MediaService, useValue: mediaService },
        { provide: AlbumsClientService, useValue: albumsClient },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: NavbarSearchService, useValue: { appliedParams: () => ({}) } },
        { provide: ConfirmDialogService, useValue: { open: vi.fn(() => of(true)) } },
        { provide: UserStore, useValue: { isAdmin: () => false } },
      ],
    })
      .overrideComponent(AlbumDetailComponent, {
        remove: { imports: [LayoutComponent] },
        add: { imports: [TestLayoutComponent] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(AlbumDetailComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const thumbnailButton = Array.from(element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Change thumbnail'),
    );

    expect(thumbnailButton).toBeTruthy();
    thumbnailButton?.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();

    expect(albumStore.update).toHaveBeenCalledWith('album-1', {
      cover_media_id: 'media-2',
      version: 2,
    });
  });

  it('uploads a new image thumbnail into the album before updating the cover', async () => {
    const albumsClient = createAlbumsClient();
    const file = new File(['cover'], 'cover.png', { type: 'image/png' });
    const dialog = {
      open: vi.fn(() => ({
        afterClosed: () => of({ coverMediaId: null, file }),
      })),
    };
    const galleryStore = {
      setParams: vi.fn(),
      loadInitial: vi.fn(() => of({ timeline: { buckets: [] }, page: null })),
      load: vi.fn(() =>
        of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 }),
      ),
      loadTimeline: vi.fn(() => of({ buckets: [] })),
      loadMore: vi.fn(() =>
        of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 }),
      ),
      clearOptimisticItems: vi.fn(),
      groupedByDay: () => [],
      timeline: () => [],
      loading: () => false,
      hasMore: () => false,
    };
    const albumStore = {
      selectedAlbum: () => ({
        id: 'album-1',
        name: 'Team album',
        description: 'Shared work',
        cover_media_id: null,
        preview_media: [{ id: 'album-1-preview' }],
        media_count: 3,
        version: 2,
        created_at: '2026-03-20T00:00:00Z',
        updated_at: '2026-03-21T00:00:00Z',
      }),
      selectedAlbumLoading: () => false,
      get: vi.fn(() => of({})),
      share: vi.fn(() => of({})),
      update: vi.fn(() => of({})),
      delete: vi.fn(() => of(void 0)),
    };
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      upload: vi.fn(() =>
        of({
          batch_id: 'b1',
          batch_url: '/batches/b1',
          batch_items_url: '/batches/b1/items',
          poll_after_seconds: 2,
          webhooks_supported: false,
          accepted: 1,
          duplicates: 0,
          errors: 0,
          results: [
            {
              id: 'uploaded-1',
              batch_item_id: 'i1',
              original_filename: 'cover.png',
              status: 'accepted',
              message: null,
            },
          ],
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ albumId: 'album-1' }) },
            paramMap: of(convertToParamMap({ albumId: 'album-1' })),
            queryParamMap: of(convertToParamMap({})),
          },
        },
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: MatDialog, useValue: dialog },
        { provide: AlbumStore, useValue: albumStore },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: MediaService, useValue: mediaService },
        { provide: AlbumsClientService, useValue: albumsClient },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: NavbarSearchService, useValue: { appliedParams: () => ({}) } },
        { provide: ConfirmDialogService, useValue: { open: vi.fn(() => of(true)) } },
        { provide: UserStore, useValue: { isAdmin: () => false } },
      ],
    })
      .overrideComponent(AlbumDetailComponent, {
        remove: { imports: [LayoutComponent] },
        add: { imports: [TestLayoutComponent] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(AlbumDetailComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const thumbnailButton = Array.from(element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Change thumbnail'),
    );

    thumbnailButton?.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();

    expect(mediaService.upload).toHaveBeenCalledWith([file], { album_id: 'album-1' });
    expect(albumStore.update).toHaveBeenCalledWith('album-1', {
      cover_media_id: 'uploaded-1',
      version: 2,
    });
    expect(galleryStore.loadInitial).toHaveBeenCalledTimes(2);
  });
});
