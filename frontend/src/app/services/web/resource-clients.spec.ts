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

  const expectRequest = (method: string, url: string) => httpTesting.expectOne(
    (request) => request.method === method && request.urlWithParams === url
  );

  it('maps users and tags requests to the correct endpoints', async () => {
    const mePromise = firstValueFrom(usersClient.getMe());
    const updateMePromise = firstValueFrom(usersClient.updateMe({ show_nsfw: true }));
    const tagsPromise = firstValueFrom(tagsClient.list({ limit: 10, offset: 20, category: 4, q: 'fox' }));

    const meRequest = expectRequest('GET', 'http://api.example.test/users/me');
    meRequest.flush({ id: 'user-1' });

    const updateMeRequest = expectRequest('PATCH', 'http://api.example.test/users/me');
    expect(updateMeRequest.request.body).toEqual({ show_nsfw: true });
    updateMeRequest.flush({ id: 'user-1', show_nsfw: true });

    const tagsRequest = expectRequest('GET', 'http://api.example.test/tags?limit=10&offset=20&category=4&q=fox');
    tagsRequest.flush([{ id: 1, name: 'fox' }]);

    await expect(mePromise).resolves.toEqual({ id: 'user-1' });
    await expect(updateMePromise).resolves.toEqual({ id: 'user-1', show_nsfw: true });
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
      character_name: 'rin',
      media_type: ['image', 'video'],
      status: ['done', 'failed'],
      captured_after: '2026-03-21T00:00:00.000Z'
    }));
    const suggestionsPromise = firstValueFrom(mediaClient.listCharacterSuggestions({ q: 'aya', limit: 5 }));

    const uploadRequest = expectRequest('POST', 'http://api.example.test/media');
    expect(uploadRequest.request.body instanceof FormData).toBe(true);
    const files = uploadRequest.request.body.getAll('files') as File[];
    expect(files.map((file) => file.name)).toEqual(['a.png', 'b.png']);
    uploadRequest.flush({ accepted: 2, duplicates: 0, errors: 0, results: [] });

    const listRequest = expectRequest('GET', 'http://api.example.test/media?page=3&page_size=25&favorited=true&character_name=rin&media_type=image,video&status=done,failed&captured_after=2026-03-21T00:00:00.000Z');
    listRequest.flush({ total: 0, page: 3, page_size: 25, items: [] });

    const suggestionsRequest = expectRequest('GET', 'http://api.example.test/media/character-suggestions?q=aya&limit=5');
    suggestionsRequest.flush([{ name: 'ayanami_rei', media_count: 2 }]);

    await expect(uploadPromise).resolves.toMatchObject({ accepted: 2 });
    await expect(listPromise).resolves.toMatchObject({ total: 0, items: [] });
    await expect(suggestionsPromise).resolves.toEqual([{ name: 'ayanami_rei', media_count: 2 }]);
  });

  it('maps the rest of the media client methods to the correct endpoints', async () => {
    const batchUpdatePromise = firstValueFrom(mediaClient.batchUpdateMedia({
      media_ids: ['m1', 'm2'],
      favorited: true
    }));
    const emptyTrashPromise = firstValueFrom(mediaClient.emptyTrash());
    const getMediaPromise = firstValueFrom(mediaClient.getMedia('media-1'));
    const updateMediaPromise = firstValueFrom(mediaClient.updateMedia('media-1', { favorited: true }));
    const deleteMediaPromise = firstValueFrom(mediaClient.deleteMedia('media-1'));
    const queueTaggingJobPromise = firstValueFrom(mediaClient.queueTaggingJob('media-1'));
    const mediaFilePromise = firstValueFrom(mediaClient.getMediaFile('media-1'));
    const thumbnailPromise = firstValueFrom(mediaClient.getMediaThumbnail('media-1'));

    const batchUpdateRequest = expectRequest('PATCH', 'http://api.example.test/media');
    expect(batchUpdateRequest.request.body).toEqual({
      media_ids: ['m1', 'm2'],
      favorited: true
    });
    batchUpdateRequest.flush({ processed: 2, skipped: 0 });

    const emptyTrashRequest = expectRequest('DELETE', 'http://api.example.test/media/trash');
    emptyTrashRequest.flush(null, { status: 204, statusText: 'No Content' });

    const getMediaRequest = expectRequest('GET', 'http://api.example.test/media/media-1');
    getMediaRequest.flush({ id: 'media-1' });

    const updateMediaRequest = expectRequest('PATCH', 'http://api.example.test/media/media-1');
    expect(updateMediaRequest.request.body).toEqual({ favorited: true });
    updateMediaRequest.flush({ id: 'media-1', favorited: true });

    const deleteMediaRequest = expectRequest('DELETE', 'http://api.example.test/media/media-1');
    deleteMediaRequest.flush(null, { status: 204, statusText: 'No Content' });

    const queueTaggingJobRequest = expectRequest('POST', 'http://api.example.test/media/media-1/tagging-jobs');
    expect(queueTaggingJobRequest.request.body).toEqual({});
    queueTaggingJobRequest.flush({ queued: 1 });

    const mediaFileRequest = expectRequest('GET', 'http://api.example.test/media/media-1/file');
    expect(mediaFileRequest.request.responseType).toBe('blob');
    mediaFileRequest.flush(new Blob(['binary']));

    const thumbnailRequest = expectRequest('GET', 'http://api.example.test/media/media-1/thumbnail');
    expect(thumbnailRequest.request.responseType).toBe('blob');
    thumbnailRequest.flush(new Blob(['thumb']));

    await expect(batchUpdatePromise).resolves.toEqual({ processed: 2, skipped: 0 });
    await expect(emptyTrashPromise).resolves.toBeNull();
    await expect(getMediaPromise).resolves.toEqual({ id: 'media-1' });
    await expect(updateMediaPromise).resolves.toEqual({ id: 'media-1', favorited: true });
    await expect(deleteMediaPromise).resolves.toBeNull();
    await expect(queueTaggingJobPromise).resolves.toEqual({ queued: 1 });
    await expect(mediaFilePromise).resolves.toBeInstanceOf(Blob);
    await expect(thumbnailPromise).resolves.toBeInstanceOf(Blob);
  });

  it('uses delete bodies and blob downloads for media and albums', async () => {
    const mediaDeletePromise = firstValueFrom(mediaClient.batchDeleteMedia({ media_ids: ['m1', 'm2'] }));
    const mediaDownloadPromise = firstValueFrom(mediaClient.downloadMedia({ media_ids: ['m1'] }));
    const listAlbumsPromise = firstValueFrom(albumsClient.listAlbums());
    const createAlbumPromise = firstValueFrom(albumsClient.createAlbum({ name: 'Favorites' }));
    const getAlbumPromise = firstValueFrom(albumsClient.getAlbum('album-1'));
    const updateAlbumPromise = firstValueFrom(albumsClient.updateAlbum('album-1', { name: 'Road Trip' }));
    const deleteAlbumPromise = firstValueFrom(albumsClient.deleteAlbum('album-2'));
    const listAlbumMediaPromise = firstValueFrom(albumsClient.listAlbumMedia('album-1', { page: 2, page_size: 12 }));
    const addMediaPromise = firstValueFrom(albumsClient.addMediaToAlbum('album-1', { media_ids: ['m1', 'm2'] }));
    const albumRemovePromise = firstValueFrom(albumsClient.removeMediaFromAlbum('album-1', { media_ids: ['m1'] }));
    const shareAlbumPromise = firstValueFrom(albumsClient.shareAlbum('album-1', { user_id: 'user-2', can_edit: true }));
    const revokeSharePromise = firstValueFrom(albumsClient.revokeShare('album-1', 'user-2'));
    const albumDownloadPromise = firstValueFrom(albumsClient.downloadAlbum('album-1'));

    const mediaDeleteRequest = expectRequest('DELETE', 'http://api.example.test/media');
    expect(mediaDeleteRequest.request.body).toEqual({ media_ids: ['m1', 'm2'] });
    mediaDeleteRequest.flush({ processed: 2, skipped: 0 });

    const mediaDownloadRequest = expectRequest('POST', 'http://api.example.test/media/download');
    expect(mediaDownloadRequest.request.responseType).toBe('blob');
    mediaDownloadRequest.flush(new Blob(['zip']));

    const listAlbumsRequest = expectRequest('GET', 'http://api.example.test/albums');
    listAlbumsRequest.flush([{ id: 'album-1' }]);

    const createAlbumRequest = expectRequest('POST', 'http://api.example.test/albums');
    expect(createAlbumRequest.request.body).toEqual({ name: 'Favorites' });
    createAlbumRequest.flush({ id: 'album-2', name: 'Favorites' });

    const getAlbumRequest = expectRequest('GET', 'http://api.example.test/albums/album-1');
    getAlbumRequest.flush({ id: 'album-1' });

    const updateAlbumRequest = expectRequest('PATCH', 'http://api.example.test/albums/album-1');
    expect(updateAlbumRequest.request.body).toEqual({ name: 'Road Trip' });
    updateAlbumRequest.flush({ id: 'album-1', name: 'Road Trip' });

    const deleteAlbumRequest = expectRequest('DELETE', 'http://api.example.test/albums/album-2');
    deleteAlbumRequest.flush(null, { status: 204, statusText: 'No Content' });

    const listAlbumMediaRequest = expectRequest('GET', 'http://api.example.test/albums/album-1/media?page=2&page_size=12');
    listAlbumMediaRequest.flush({ total: 1, page: 2, page_size: 12, items: [] });

    const addMediaRequest = expectRequest('PUT', 'http://api.example.test/albums/album-1/media');
    expect(addMediaRequest.request.body).toEqual({ media_ids: ['m1', 'm2'] });
    addMediaRequest.flush({ processed: 2, skipped: 0 });

    const albumRemoveRequest = expectRequest('DELETE', 'http://api.example.test/albums/album-1/media');
    expect(albumRemoveRequest.request.body).toEqual({ media_ids: ['m1'] });
    albumRemoveRequest.flush({ processed: 1, skipped: 0 });

    const shareAlbumRequest = expectRequest('POST', 'http://api.example.test/albums/album-1/shares');
    expect(shareAlbumRequest.request.body).toEqual({ user_id: 'user-2', can_edit: true });
    shareAlbumRequest.flush({ user_id: 'user-2', can_edit: true });

    const revokeShareRequest = expectRequest('DELETE', 'http://api.example.test/albums/album-1/shares/user-2');
    revokeShareRequest.flush(null, { status: 204, statusText: 'No Content' });

    const albumDownloadRequest = expectRequest('GET', 'http://api.example.test/albums/album-1/download');
    expect(albumDownloadRequest.request.responseType).toBe('blob');
    albumDownloadRequest.flush(new Blob(['zip']));

    await expect(mediaDeletePromise).resolves.toEqual({ processed: 2, skipped: 0 });
    await expect(mediaDownloadPromise).resolves.toBeInstanceOf(Blob);
    await expect(listAlbumsPromise).resolves.toEqual([{ id: 'album-1' }]);
    await expect(createAlbumPromise).resolves.toEqual({ id: 'album-2', name: 'Favorites' });
    await expect(getAlbumPromise).resolves.toEqual({ id: 'album-1' });
    await expect(updateAlbumPromise).resolves.toEqual({ id: 'album-1', name: 'Road Trip' });
    await expect(deleteAlbumPromise).resolves.toBeNull();
    await expect(listAlbumMediaPromise).resolves.toMatchObject({ total: 1, page: 2, page_size: 12, items: [] });
    await expect(addMediaPromise).resolves.toEqual({ processed: 2, skipped: 0 });
    await expect(albumRemovePromise).resolves.toEqual({ processed: 1, skipped: 0 });
    await expect(shareAlbumPromise).resolves.toEqual({ user_id: 'user-2', can_edit: true });
    await expect(revokeSharePromise).resolves.toBeNull();
    await expect(albumDownloadPromise).resolves.toBeInstanceOf(Blob);
  });

  it('maps admin requests and preserves query names', async () => {
    const statsPromise = firstValueFrom(adminClient.getStats());
    const listUsersPromise = firstValueFrom(adminClient.listUsers({ page: 2, page_size: 40 }));
    const userDetailPromise = firstValueFrom(adminClient.getUserDetail('user-2'));
    const updateUserPromise = firstValueFrom(adminClient.updateUser('user-2', { is_admin: true }));
    const deleteUserPromise = firstValueFrom(adminClient.deleteUser('user-2', true));
    const queuePromise = firstValueFrom(adminClient.queueUserTaggingJobs('user-2'));

    const statsRequest = expectRequest('GET', 'http://api.example.test/admin/stats');
    statsRequest.flush({
      total_users: 1,
      total_media: 2,
      total_storage_bytes: 3,
      pending_tagging: 4,
      failed_tagging: 5,
      trashed_media: 6
    });

    const listUsersRequest = expectRequest('GET', 'http://api.example.test/admin/users?page=2&page_size=40');
    listUsersRequest.flush({ total: 1, page: 2, page_size: 40, items: [] });

    const userDetailRequest = expectRequest('GET', 'http://api.example.test/admin/users/user-2');
    userDetailRequest.flush({ id: 'user-2' });

    const updateUserRequest = expectRequest('PATCH', 'http://api.example.test/admin/users/user-2');
    expect(updateUserRequest.request.body).toEqual({ is_admin: true });
    updateUserRequest.flush({ id: 'user-2', is_admin: true });

    const deleteUserRequest = expectRequest('DELETE', 'http://api.example.test/admin/users/user-2?delete_media=true');
    deleteUserRequest.flush(null, { status: 204, statusText: 'No Content' });

    const queueRequest = expectRequest('POST', 'http://api.example.test/admin/users/user-2/tagging-jobs');
    expect(queueRequest.request.body).toEqual({});
    queueRequest.flush({ queued: 7 });

    await expect(statsPromise).resolves.toEqual({
      total_users: 1,
      total_media: 2,
      total_storage_bytes: 3,
      pending_tagging: 4,
      failed_tagging: 5,
      trashed_media: 6
    });
    await expect(listUsersPromise).resolves.toMatchObject({ total: 1, page: 2 });
    await expect(userDetailPromise).resolves.toEqual({ id: 'user-2' });
    await expect(updateUserPromise).resolves.toEqual({ id: 'user-2', is_admin: true });
    await expect(deleteUserPromise).resolves.toBeNull();
    await expect(queuePromise).resolves.toEqual({ queued: 7 });
  });
});
