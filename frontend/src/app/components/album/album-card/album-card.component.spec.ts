import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AlbumAccessRole } from '../../../models/albums';
import { MediaService } from '../../../services/media.service';
import { AlbumsClientService } from '../../../services/web/albums-client.service';
import { AlbumCardComponent } from './album-card.component';

describe('AlbumCardComponent', () => {
  it('renders a 2x2 preview grid when at least four thumbnails are available', async () => {
    const getThumbnailUrl = vi.fn((id: string) => of(`blob:${id}`));
    const albumsClient = {
      listMedia: vi.fn(() => of({ items: [] })),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumCardComponent],
      providers: [
        provideRouter([]),
        { provide: AlbumsClientService, useValue: albumsClient },
        { provide: MediaService, useValue: { getThumbnailUrl } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumCardComponent);
    fixture.componentRef.setInput('album', {
      id: 'a1',
      owner_id: 'u1',
      owner: { id: 'u1', username: 'owner' },
      access_role: AlbumAccessRole.OWNER,
      name: 'Preview album',
      description: 'desc',
      cover_media_id: null,
      preview_media: [
        { id: 'm1' },
        { id: 'm2' },
        { id: 'm3' },
        { id: 'm4' },
        { id: 'm5' },
      ],
      media_count: 5,
      version: 1,
      created_at: '2026-03-20T00:00:00Z',
      updated_at: '2026-03-21T00:00:00Z',
    });
    fixture.detectChanges();

    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const previewGrid = host.querySelector('.album-card__preview-grid');
    const previewTiles = host.querySelectorAll('.album-card__preview-tile');
    const overflowBadge = host.querySelector('.album-card__preview-overflow');

    expect(previewGrid?.getAttribute('data-layout')).toBe('quad');
    expect(previewTiles.length).toBe(4);
    expect(overflowBadge).toBeNull();
  });

  it('renders a three-image fallback layout with one hero tile', async () => {
    const getThumbnailUrl = vi.fn((id: string) => of(`blob:${id}`));
    const albumsClient = {
      listMedia: vi.fn(() => of({ items: [] })),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumCardComponent],
      providers: [
        provideRouter([]),
        { provide: AlbumsClientService, useValue: albumsClient },
        { provide: MediaService, useValue: { getThumbnailUrl } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumCardComponent);
    fixture.componentRef.setInput('album', {
      id: 'a1',
      owner_id: 'u1',
      owner: { id: 'u1', username: 'owner' },
      access_role: AlbumAccessRole.OWNER,
      name: 'Preview album',
      description: 'desc',
      cover_media_id: null,
      preview_media: [
        { id: 'm1' },
        { id: 'm2' },
        { id: 'm3' },
      ],
      media_count: 3,
      version: 1,
      created_at: '2026-03-20T00:00:00Z',
      updated_at: '2026-03-21T00:00:00Z',
    });
    fixture.detectChanges();

    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const previewGrid = host.querySelector('.album-card__preview-grid');
    const heroTile = host.querySelector('.album-card__preview-tile--hero');

    expect(previewGrid?.getAttribute('data-layout')).toBe('trio');
    expect(heroTile).not.toBeNull();
  });

  it('fetches more album media for previews when the album payload only contains one preview item', async () => {
    const getThumbnailUrl = vi.fn((id: string) => of(`blob:${id}`));
    const albumsClient = {
      listMedia: vi.fn(() => of({
        items: [
          { id: 'm1' },
          { id: 'm2' },
          { id: 'm3' },
          { id: 'm4' },
        ],
      })),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumCardComponent],
      providers: [
        provideRouter([]),
        { provide: AlbumsClientService, useValue: albumsClient },
        { provide: MediaService, useValue: { getThumbnailUrl } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumCardComponent);
    fixture.componentRef.setInput('album', {
      id: 'a1',
      owner_id: 'u1',
      owner: { id: 'u1', username: 'owner' },
      access_role: AlbumAccessRole.OWNER,
      name: 'Preview album',
      description: 'desc',
      cover_media_id: null,
      preview_media: [{ id: 'm1' }],
      media_count: 25,
      version: 1,
      created_at: '2026-03-20T00:00:00Z',
      updated_at: '2026-03-21T00:00:00Z',
    });
    fixture.detectChanges();

    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const previewGrid = host.querySelector('.album-card__preview-grid');
    const previewTiles = host.querySelectorAll('.album-card__preview-tile');

    expect(albumsClient.listMedia).toHaveBeenCalledWith('a1', { page_size: 4 });
    expect(previewGrid?.getAttribute('data-layout')).toBe('quad');
    expect(previewTiles.length).toBe(4);
    expect(getThumbnailUrl).toHaveBeenCalledWith('m4');
  });

  it('shows the selected thumbnail as a single cover when it differs from the default album preview', async () => {
    const getThumbnailUrl = vi.fn((id: string) => of(`blob:${id}`));
    const albumsClient = {
      listMedia: vi.fn(() => of({ items: [] })),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumCardComponent],
      providers: [
        provideRouter([]),
        { provide: AlbumsClientService, useValue: albumsClient },
        { provide: MediaService, useValue: { getThumbnailUrl } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumCardComponent);
    fixture.componentRef.setInput('album', {
      id: 'a1',
      owner_id: 'u1',
      owner: { id: 'u1', username: 'owner' },
      access_role: AlbumAccessRole.OWNER,
      name: 'Cover album',
      description: null,
      cover_media_id: 'cover-1',
      preview_media: [
        { id: 'm2' },
        { id: 'm3' },
      ],
      media_count: 4,
      version: 1,
      created_at: '2026-03-20T00:00:00Z',
      updated_at: '2026-03-21T00:00:00Z',
    });
    fixture.detectChanges();

    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const previewGrid = host.querySelector('.album-card__preview-grid');
    const previewTiles = host.querySelectorAll('.album-card__preview-tile');
    const previewImages = Array.from(host.querySelectorAll('.album-card__preview-tile img'));

    expect(previewGrid?.getAttribute('data-layout')).toBe('single');
    expect(previewTiles.length).toBe(1);
    expect(previewImages[0]?.getAttribute('src')).toBe('blob:cover-1');
    expect(getThumbnailUrl).toHaveBeenCalledWith('cover-1');
    expect(albumsClient.listMedia).not.toHaveBeenCalled();
  });

  it('keeps the grid layout for backend-default covers when preview media starts with the cover id', async () => {
    const getThumbnailUrl = vi.fn((id: string) => of(`blob:${id}`));
    const albumsClient = {
      listMedia: vi.fn(() => of({
        items: [
          { id: 'm1' },
          { id: 'm2' },
          { id: 'm3' },
          { id: 'm4' },
        ],
      })),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumCardComponent],
      providers: [
        provideRouter([]),
        { provide: AlbumsClientService, useValue: albumsClient },
        { provide: MediaService, useValue: { getThumbnailUrl } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumCardComponent);
    fixture.componentRef.setInput('album', {
      id: 'a1',
      owner_id: 'u1',
      owner: { id: 'u1', username: 'owner' },
      access_role: AlbumAccessRole.OWNER,
      name: 'Auto cover album',
      description: null,
      cover_media_id: 'm1',
      preview_media: [{ id: 'm1' }],
      media_count: 25,
      version: 1,
      created_at: '2026-03-20T00:00:00Z',
      updated_at: '2026-03-21T00:00:00Z',
    });
    fixture.detectChanges();

    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const previewGrid = host.querySelector('.album-card__preview-grid');
    const previewTiles = host.querySelectorAll('.album-card__preview-tile');

    expect(albumsClient.listMedia).toHaveBeenCalledWith('a1', { page_size: 4 });
    expect(previewGrid?.getAttribute('data-layout')).toBe('quad');
    expect(previewTiles.length).toBe(4);
  });

  it('renders a single preview when the album only has one covered item', async () => {
    const getThumbnailUrl = vi.fn((id: string) => of(`blob:${id}`));
    const albumsClient = {
      listMedia: vi.fn(() => of({ items: [] })),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumCardComponent],
      providers: [
        provideRouter([]),
        { provide: AlbumsClientService, useValue: albumsClient },
        { provide: MediaService, useValue: { getThumbnailUrl } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumCardComponent);
    fixture.componentRef.setInput('album', {
      id: 'a1',
      owner_id: 'u1',
      owner: { id: 'u1', username: 'owner' },
      access_role: AlbumAccessRole.OWNER,
      name: 'Single album',
      description: null,
      cover_media_id: 'cover-1',
      preview_media: [],
      media_count: 1,
      version: 1,
      created_at: '2026-03-20T00:00:00Z',
      updated_at: '2026-03-21T00:00:00Z',
    });
    fixture.detectChanges();

    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const previewGrid = host.querySelector('.album-card__preview-grid');
    const previewTiles = host.querySelectorAll('.album-card__preview-tile');

    expect(previewGrid?.getAttribute('data-layout')).toBe('single');
    expect(previewTiles.length).toBe(1);
    expect(albumsClient.listMedia).not.toHaveBeenCalled();
  });
});
