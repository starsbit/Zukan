import '@angular/compiler';
import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { describe, beforeEach, expect, it, vi } from 'vitest';

import { AlbumsPageComponent } from './albums-page.component';
import { AlbumRead } from '../../models/api';
import { AlbumCardComponent } from '../../components/album-card/album-card.component';
import { AppSidebarComponent } from '../../components/app-sidebar/app-sidebar.component';
import { AlbumsService } from '../../services/albums.service';

@Component({
  selector: 'app-album-card',
  template: '',
  standalone: true
})
class StubAlbumCardComponent {
  @Input({ required: true }) album!: unknown;
}

@Component({
  selector: 'app-sidebar',
  template: '',
  standalone: true
})
class StubSidebarComponent {}

describe('AlbumsPageComponent', () => {
  let fixture: ComponentFixture<AlbumsPageComponent>;
  let component: AlbumsPageComponent;
  let albumsService: {
    albums$: BehaviorSubject<AlbumRead[]>;
    loading$: BehaviorSubject<boolean>;
    error$: BehaviorSubject<unknown | null>;
    loadAlbums: ReturnType<typeof vi.fn>;
    createAlbum: ReturnType<typeof vi.fn>;
  };
  let dialog: { open: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  const album: AlbumRead = {
    id: 'album-1',
    owner_id: 'user-1',
    name: 'Road Trip',
    description: 'Spring photos',
    cover_media_id: null,
    media_count: 2,
    version: 1,
    created_at: '2026-03-21T00:00:00Z',
    updated_at: '2026-03-21T00:00:00Z'
  };

  beforeEach(async () => {
    albumsService = {
      albums$: new BehaviorSubject([album]),
      loading$: new BehaviorSubject(false),
      error$: new BehaviorSubject<unknown | null>(null),
      loadAlbums: vi.fn().mockReturnValue(of([album])),
      createAlbum: vi.fn().mockReturnValue(of({ ...album, id: 'album-2', name: 'New Album', description: 'Notes' }))
    };
    dialog = {
      open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined) })
    };
    snackBar = {
      open: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [AlbumsPageComponent],
      providers: [
        provideRouter([]),
        { provide: AlbumsService, useValue: albumsService },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar }
      ]
    })
      .overrideComponent(AlbumsPageComponent, {
        remove: { imports: [AlbumCardComponent, AppSidebarComponent] },
        add: { imports: [StubAlbumCardComponent, StubSidebarComponent] }
      })
      .compileComponents();

    fixture = TestBed.createComponent(AlbumsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads albums on creation', () => {
    expect(albumsService.loadAlbums).toHaveBeenCalled();
  });

  it('renders album cards when albums are available', () => {
    expect(fixture.nativeElement.querySelectorAll('app-album-card')).toHaveLength(1);
  });

  it('creates an album from the dialog flow', () => {
    dialog.open.mockReturnValue({ afterClosed: () => of({ name: 'New Album', description: 'Notes' }) });

    component.createAlbum();

    expect(albumsService.createAlbum).toHaveBeenCalledWith({ name: 'New Album', description: 'Notes' });
    expect(snackBar.open).toHaveBeenCalled();
  });
});
