import '@angular/compiler';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Observable } from 'rxjs';

import { GallerySearchOptionsDialogComponent } from './gallery-search-options-dialog.component';
import { createDefaultGallerySearchFilters } from '../gallery-search.utils';
import { AlbumRead } from '../../../models/api';
import { AlbumsService } from '../../../services/albums.service';

describe('GallerySearchOptionsDialogComponent', () => {
  let fixture: ComponentFixture<GallerySearchOptionsDialogComponent>;
  let component: GallerySearchOptionsDialogComponent;
  let dialogRef: { close: ReturnType<typeof vi.fn> };
  let albumsService: { albums$: Observable<AlbumRead[]>; snapshot: { albums: AlbumRead[] }; loadAlbums: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    dialogRef = {
      close: vi.fn()
    };
    albumsService = {
      albums$: of([{
        id: 'album-1',
        owner_id: 'user-1',
        name: 'Road Trip',
        description: null,
        cover_media_id: null,
        media_count: 2,
        created_at: '2026-03-21T00:00:00Z',
        updated_at: '2026-03-21T00:00:00Z'
      }]),
      snapshot: {
        albums: [{
          id: 'album-1',
          owner_id: 'user-1',
          name: 'Road Trip',
          description: null,
          cover_media_id: null,
          media_count: 2,
          created_at: '2026-03-21T00:00:00Z',
          updated_at: '2026-03-21T00:00:00Z'
        }]
      },
      loadAlbums: vi.fn().mockReturnValue(of([{
        id: 'album-1',
        owner_id: 'user-1',
        name: 'Road Trip',
        description: null,
        cover_media_id: null,
        media_count: 2,
        created_at: '2026-03-21T00:00:00Z',
        updated_at: '2026-03-21T00:00:00Z'
      }]))
    };

    await TestBed.configureTestingModule({
      imports: [GallerySearchOptionsDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: AlbumsService, useValue: albumsService },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            filters: {
              favorited: 'only',
              album_id: 'album-1',
              nsfw: 'include',
              status: ['done', 'failed'],
              media_type: ['image'],
              captured_after: '2024-01-01T12:00',
              captured_before: '2024-01-05T12:00'
            }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GallerySearchOptionsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('initializes the form from the injected dialog data', () => {
    expect(component.form.getRawValue()).toEqual({
      favorited: 'only',
      album_id: 'album-1',
      nsfw: 'include',
      status: ['done', 'failed'],
      media_type: ['image'],
      captured_after: '2024-01-01T12:00',
      captured_before: '2024-01-05T12:00'
    });
  });

  it('clears all filters back to the defaults', () => {
    component.clearAll();

    expect(component.form.getRawValue()).toEqual({
      favorited: 'any',
      album_id: '',
      nsfw: 'default',
      status: ['pending', 'processing', 'done', 'failed'],
      media_type: [],
      captured_after: '',
      captured_before: ''
    });
  });

  it('applies the current form values and normalizes blank dates to null', () => {
    component.form.setValue({
      favorited: 'only',
      album_id: 'album-1',
      nsfw: 'only',
      status: ['processing'],
      media_type: ['video'],
      captured_after: '',
      captured_before: '2024-02-01T10:00'
    });

    component.apply();

    expect(dialogRef.close).toHaveBeenCalledWith({
      favorited: 'only',
      album_id: 'album-1',
      nsfw: 'only',
      status: ['processing'],
      media_type: ['video'],
      captured_after: null,
      captured_before: '2024-02-01T10:00'
    });
  });

  it('toggles status and media type chip selections', () => {
    component.toggleStatus('failed');
    component.toggleStatus('done');
    component.toggleMediaType('video');
    component.toggleMediaType('image');

    expect(component.form.controls.status.getRawValue()).toEqual([]);
    expect(component.form.controls.media_type.getRawValue()).toEqual(['video']);
  });

  it('renders the expected title and action buttons', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Search options');
    expect(text).toContain('Clear all');
    expect(text).toContain('Album');
    expect(text).toContain('Search');
    expect(text).toContain('Done');
    expect(text).toContain('Failed');
    expect(text).toContain('Image');
    expect(createDefaultGallerySearchFilters().status).toContain('done');
  });

  it('can hide album selection when the dialog is opened in a locked album context', async () => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [GallerySearchOptionsDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: AlbumsService, useValue: albumsService },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            filters: createDefaultGallerySearchFilters(),
            albumSelectionEnabled: false
          }
        }
      ]
    }).compileComponents();

    const hiddenAlbumFixture = TestBed.createComponent(GallerySearchOptionsDialogComponent);
    hiddenAlbumFixture.detectChanges();

    expect(hiddenAlbumFixture.nativeElement.textContent).not.toContain('Album');
  });
});
