import { By } from '@angular/platform-browser';
import { AlbumCardComponent } from '../../components/album/album-card/album-card.component';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
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
        { provide: UserStore, useValue: { currentUser: () => null } },
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

  it('uses cover_media_id as a preview fallback when preview_media is missing', async () => {
    const dialog = {
      open: vi.fn(() => ({ afterClosed: () => of(undefined) })),
    };
    const getThumbnailUrl = vi.fn(() => of('blob:thumb'));
    const albumStore = {
      items: () => [
        {
          id: 'a1',
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

    const card = fixture.debugElement.query(By.directive(AlbumCardComponent))
      .componentInstance as AlbumCardComponent;
    card.onViewportVisible();
    expect(getThumbnailUrl).toHaveBeenCalledWith('m-cover');
  });
});
