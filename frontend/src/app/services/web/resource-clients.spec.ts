import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CLIENT_API_BASE_URL } from './api.config';
import { AdminClientService } from './admin-client.service';
import { AlbumsClientService } from './albums-client.service';
import { MediaClientService } from './media-client.service';
import { TagsClientService } from './tags-client.service';
import { UsersClientService } from './users-client.service';

describe('resource clients', () => {
  let usersClient: UsersClientService;
  let tagsClient: TagsClientService;
  let mediaClient: MediaClientService;
  let albumsClient: AlbumsClientService;
  let adminClient: AdminClientService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        UsersClientService,
        TagsClientService,
        MediaClientService,
        AlbumsClientService,
        AdminClientService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CLIENT_API_BASE_URL, useValue: 'http://api.example.test' }
      ]
    });

    usersClient = TestBed.inject(UsersClientService);
    tagsClient = TestBed.inject(TagsClientService);
    mediaClient = TestBed.inject(MediaClientService);
    albumsClient = TestBed.inject(AlbumsClientService);
    adminClient = TestBed.inject(AdminClientService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('maps users and tags requests to the correct endpoints', async () => {
    const mePromise = firstValueFrom(usersClient.getMe());
    const tagsPromise = firstValueFrom(tagsClient.list({ limit: 10, offset: 20, category: 4, q: 'fox' }));

    const meRequest = httpTesting.expectOne('http://api.example.test/users/me');
    expect(meRequest.request.method).toBe('GET');
    meRequest.flush({ id: 'user-1' });

    const tagsRequest = httpTesting.expectOne('http://api.example.test/tags?limit=10&offset=20&category=4&q=fox');
    expect(tagsRequest.request.method).toBe('GET');
    tagsRequest.flush([{ id: 1, name: 'fox' }]);

    await expect(mePromise).resolves.toEqual({ id: 'user-1' });
    await expect(tagsPromise).resolves.toEqual([{ id: 1, name: 'fox' }]);
  });

  it('builds media upload payloads and media query params correctly', async () => {
    const uploadPromise = firstValueFrom(mediaClient.uploadMedia([
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' })
    ]));
    const listPromise = firstValueFrom(mediaClient.listMedia({
      page: 3,
      page_size: 25,
      favorited: true,
      character_name: 'rin'
    }));

    const uploadRequest = httpTesting.expectOne('http://api.example.test/media');
    expect(uploadRequest.request.method).toBe('POST');
    expect(uploadRequest.request.body instanceof FormData).toBe(true);
    const files = uploadRequest.request.body.getAll('files') as File[];
    expect(files.map((file) => file.name)).toEqual(['a.png', 'b.png']);
    uploadRequest.flush({ accepted: 2, duplicates: 0, errors: 0, results: [] });

    const listRequest = httpTesting.expectOne('http://api.example.test/media?page=3&page_size=25&favorited=true&character_name=rin');
    expect(listRequest.request.method).toBe('GET');
    listRequest.flush({ total: 0, page: 3, page_size: 25, items: [] });

    await expect(uploadPromise).resolves.toMatchObject({ accepted: 2 });
    await expect(listPromise).resolves.toMatchObject({ total: 0, items: [] });
  });

  it('uses delete bodies and blob downloads for media and albums', async () => {
    const mediaDeletePromise = firstValueFrom(mediaClient.batchDeleteMedia({ media_ids: ['m1', 'm2'] }));
    const mediaDownloadPromise = firstValueFrom(mediaClient.downloadMedia({ media_ids: ['m1'] }));
    const albumRemovePromise = firstValueFrom(albumsClient.removeMediaFromAlbum('album-1', { media_ids: ['m1'] }));
    const albumDownloadPromise = firstValueFrom(albumsClient.downloadAlbum('album-1'));

    const mediaDeleteRequest = httpTesting.expectOne('http://api.example.test/media');
    expect(mediaDeleteRequest.request.method).toBe('DELETE');
    expect(mediaDeleteRequest.request.body).toEqual({ media_ids: ['m1', 'm2'] });
    mediaDeleteRequest.flush({ processed: 2, skipped: 0 });

    const mediaDownloadRequest = httpTesting.expectOne('http://api.example.test/media/download');
    expect(mediaDownloadRequest.request.responseType).toBe('blob');
    mediaDownloadRequest.flush(new Blob(['zip']));

    const albumRemoveRequest = httpTesting.expectOne('http://api.example.test/albums/album-1/media');
    expect(albumRemoveRequest.request.method).toBe('DELETE');
    expect(albumRemoveRequest.request.body).toEqual({ media_ids: ['m1'] });
    albumRemoveRequest.flush({ processed: 1, skipped: 0 });

    const albumDownloadRequest = httpTesting.expectOne('http://api.example.test/albums/album-1/download');
    expect(albumDownloadRequest.request.responseType).toBe('blob');
    albumDownloadRequest.flush(new Blob(['zip']));

    await expect(mediaDeletePromise).resolves.toEqual({ processed: 2, skipped: 0 });
    await expect(mediaDownloadPromise).resolves.toBeInstanceOf(Blob);
    await expect(albumRemovePromise).resolves.toEqual({ processed: 1, skipped: 0 });
    await expect(albumDownloadPromise).resolves.toBeInstanceOf(Blob);
  });

  it('maps admin requests and preserves query names', async () => {
    const listUsersPromise = firstValueFrom(adminClient.listUsers({ page: 2, page_size: 40 }));
    const deleteUserPromise = firstValueFrom(adminClient.deleteUser('user-2', true));
    const queuePromise = firstValueFrom(adminClient.queueUserTaggingJobs('user-2'));

    const listUsersRequest = httpTesting.expectOne('http://api.example.test/admin/users?page=2&page_size=40');
    expect(listUsersRequest.request.method).toBe('GET');
    listUsersRequest.flush({ total: 1, page: 2, page_size: 40, items: [] });

    const deleteUserRequest = httpTesting.expectOne('http://api.example.test/admin/users/user-2?delete_media=true');
    expect(deleteUserRequest.request.method).toBe('DELETE');
    deleteUserRequest.flush(null, { status: 204, statusText: 'No Content' });

    const queueRequest = httpTesting.expectOne('http://api.example.test/admin/users/user-2/tagging-jobs');
    expect(queueRequest.request.method).toBe('POST');
    expect(queueRequest.request.body).toEqual({});
    queueRequest.flush({ queued: 7 });

    await expect(listUsersPromise).resolves.toMatchObject({ total: 1, page: 2 });
    await expect(deleteUserPromise).resolves.toBeNull();
    await expect(queuePromise).resolves.toEqual({ queued: 7 });
  });
});
