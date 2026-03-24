import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { AlbumsService } from './albums.service';
import { CLIENT_API_BASE_URL } from './web/api.config';
import { AlbumsClientService } from './web/albums-client.service';

const createAlbum = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'album-1',
  owner_id: 'user-1',
  name: 'Favorites',
  description: null,
  cover_media_id: null,
  media_count: 2,
  version: 1,
  created_at: '2026-03-21T00:00:00Z',
  updated_at: '2026-03-21T00:00:00Z',
  ...overrides
});

const createMedia = (id: string) => ({
  id,
  uploader_id: 'user-1',
  filename: `${id}.png`,
  original_filename: `${id}.png`,
  metadata: {
    file_size: 100,
    width: 10,
    height: 10,
    mime_type: 'image/png',
    captured_at: '2026-03-21T00:00:00Z'
  },
  tags: [],
  is_nsfw: false,
  tagging_status: 'done',
  thumbnail_status: 'ready',
  version: 1,
  created_at: '2026-03-21T00:00:00Z',
  deleted_at: null
});

describe('AlbumsService', () => {
  let service: AlbumsService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AlbumsService,
        AlbumsClientService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CLIENT_API_BASE_URL, useValue: 'http://api.example.test' }
      ]
    });

    service = TestBed.inject(AlbumsService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('creates albums and prepends them to the cached list', async () => {
    service['stateSubject'].next({
      ...service.snapshot,
      albums: [createAlbum({ id: 'album-1', name: 'Existing', media_count: 1 })]
    });

    const createPromise = firstValueFrom(service.createAlbum({ name: 'New Album' }));
    const request = httpTesting.expectOne('http://api.example.test/albums');
    request.flush(createAlbum({ id: 'album-2', name: 'New Album', media_count: 0 }));

    await expect(createPromise).resolves.toMatchObject({ id: 'album-2' });
    expect(service.snapshot.albums.map((album) => album.id)).toEqual(['album-2', 'album-1']);
  });

  it('removes media from the selected album cache in place', async () => {
    service['stateSubject'].next({
      ...service.snapshot,
      selectedAlbum: createAlbum(),
      selectedAlbumMedia: {
        total: 2,
        next_cursor: null,
        page_size: 20,
        items: [createMedia('media-1'), createMedia('media-2')]
      }
    });

    const removePromise = firstValueFrom(service.removeMedia('album-1', { media_ids: ['media-1'] }));
    const request = httpTesting.expectOne('http://api.example.test/albums/album-1/media');
    expect(request.request.method).toBe('DELETE');
    request.flush({ processed: 1, skipped: 0 });

    await expect(removePromise).resolves.toEqual({ processed: 1, skipped: 0 });
    expect(service.snapshot.selectedAlbumMedia?.items.map((item) => item.id)).toEqual(['media-2']);
    expect(service.snapshot.selectedAlbum?.media_count).toBe(1);
  });

  it('loads albums, album detail, and album media', async () => {
    const listPromise = firstValueFrom(service.loadAlbums());
    const listRequest = httpTesting.expectOne('http://api.example.test/albums');
    listRequest.flush({ total: 1, next_cursor: null, prev_cursor: null, has_more: false, page_size: 50, items: [createAlbum()] });
    await expect(listPromise).resolves.toHaveLength(1);

    const detailPromise = firstValueFrom(service.loadAlbum('album-1'));
    const detailRequest = httpTesting.expectOne('http://api.example.test/albums/album-1');
    detailRequest.flush(createAlbum({ name: 'Detailed' }));
    await expect(detailPromise).resolves.toMatchObject({ name: 'Detailed' });

    const mediaPromise = firstValueFrom(service.loadAlbumMedia('album-1', { after: 'cursor-2', page_size: 10 }));
    const mediaRequest = httpTesting.expectOne('http://api.example.test/albums/album-1/media?after=cursor-2&page_size=10');
    mediaRequest.flush({ total: 1, next_cursor: null, page_size: 10, items: [createMedia('media-1')] });
    await expect(mediaPromise).resolves.toMatchObject({ total: 1, next_cursor: null });

    const refreshPromise = firstValueFrom(service.refreshAlbumMedia());
    const refreshRequest = httpTesting.expectOne('http://api.example.test/albums/album-1/media?after=cursor-2&page_size=10');
    refreshRequest.flush({ total: 0, next_cursor: null, page_size: 10, items: [] });
    await expect(refreshPromise).resolves.toMatchObject({ total: 0, items: [] });
  });

  it('updates and deletes albums in cache', async () => {
    service['stateSubject'].next({
      ...service.snapshot,
      albums: [createAlbum()],
      selectedAlbum: createAlbum(),
      selectedAlbumMedia: { total: 1, next_cursor: null, page_size: 20, items: [createMedia('media-1')] },
      selectedAlbumMediaQuery: { after: 'cursor-1' }
    });

    const updatePromise = firstValueFrom(service.updateAlbum('album-1', { name: 'Road Trip' }));
    const updateRequest = httpTesting.expectOne('http://api.example.test/albums/album-1');
    updateRequest.flush(createAlbum({ name: 'Road Trip' }));
    await expect(updatePromise).resolves.toMatchObject({ name: 'Road Trip' });
    expect(service.snapshot.albums[0]?.name).toBe('Road Trip');
    expect(service.snapshot.selectedAlbum?.name).toBe('Road Trip');

    const deletePromise = firstValueFrom(service.deleteAlbum('album-1'));
    const deleteRequest = httpTesting.expectOne('http://api.example.test/albums/album-1');
    expect(deleteRequest.request.method).toBe('DELETE');
    deleteRequest.flush(null, { status: 204, statusText: 'No Content' });
    await expect(deletePromise).resolves.toBeNull();
    expect(service.snapshot.albums).toEqual([]);
    expect(service.snapshot.selectedAlbum).toBeNull();
    expect(service.snapshot.selectedAlbumMedia).toBeNull();
  });

  it('invalidates selected album media when adding media and supports sharing and downloads', async () => {
    service['stateSubject'].next({
      ...service.snapshot,
      albums: [createAlbum()],
      selectedAlbum: createAlbum(),
      selectedAlbumMedia: { total: 1, next_cursor: null, page_size: 20, items: [createMedia('media-1')] }
    });

    const addPromise = firstValueFrom(service.addMedia('album-1', { media_ids: ['media-2', 'media-3'] }));
    const addRequest = httpTesting.expectOne('http://api.example.test/albums/album-1/media');
    expect(addRequest.request.method).toBe('PUT');
    addRequest.flush({ processed: 2, skipped: 0 });
    await expect(addPromise).resolves.toEqual({ processed: 2, skipped: 0 });
    expect(service.snapshot.selectedAlbum?.media_count).toBe(4);
    expect(service.snapshot.selectedAlbumMedia).toBeNull();

    const sharePromise = firstValueFrom(service.shareAlbum('album-1', { user_id: 'user-2', role: 'editor' }));
    const shareRequest = httpTesting.expectOne('http://api.example.test/albums/album-1/shares');
    shareRequest.flush({ user_id: 'user-2', role: 'editor', shared_at: '2026-03-21T00:00:00Z', shared_by_user_id: 'user-1' });
    await expect(sharePromise).resolves.toEqual({ user_id: 'user-2', role: 'editor', shared_at: '2026-03-21T00:00:00Z', shared_by_user_id: 'user-1' });

    const revokePromise = firstValueFrom(service.revokeShare('album-1', 'user-2'));
    const revokeRequest = httpTesting.expectOne('http://api.example.test/albums/album-1/shares/user-2');
    revokeRequest.flush(null, { status: 204, statusText: 'No Content' });
    await expect(revokePromise).resolves.toBeNull();

    const downloadPromise = firstValueFrom(service.downloadAlbum('album-1'));
    const downloadRequest = httpTesting.expectOne('http://api.example.test/albums/album-1/download');
    const blob = new Blob(['zip']);
    downloadRequest.flush(blob);
    await expect(downloadPromise).resolves.toEqual(blob);
  });

  it('surfaces refresh and mutation errors', async () => {
    await expect(firstValueFrom(service.refreshAlbumMedia())).rejects.toThrow('No album selected');

    const listPromise2 = firstValueFrom(service.loadAlbums());
    const listRequest = httpTesting.expectOne('http://api.example.test/albums');
    listRequest.flush({ detail: 'broken' }, { status: 500, statusText: 'Server Error' });
    await expect(listPromise2).rejects.toMatchObject({ status: 500 });
    expect(service.snapshot.request.error).toMatchObject({ status: 500 });

    const createPromise = firstValueFrom(service.createAlbum({ name: 'Broken' }));
    const createRequest = httpTesting.expectOne('http://api.example.test/albums');
    createRequest.flush({ detail: 'broken' }, { status: 500, statusText: 'Server Error' });
    await expect(createPromise).rejects.toMatchObject({ status: 500 });
    expect(service.snapshot.mutationError).toMatchObject({ status: 500 });
  });
});
