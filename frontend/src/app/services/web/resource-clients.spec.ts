import '@angular/compiler';
import { HttpEventType } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CLIENT_API_BASE_URL } from './api.config';
import { AdminClientService } from './admin-client.service';
import { AlbumsClientService } from './albums-client.service';
import { BatchesClientService } from './batches-client.service';
import { ConfigClientService } from './config-client.service';
import { MediaClientService } from './media-client.service';
import { NotificationsClientService } from './notifications-client.service';
import { TagsClientService } from './tags-client.service';
import { UsersClientService } from './users-client.service';

describe('resource clients', () => {
  let usersClient: UsersClientService;
  let tagsClient: TagsClientService;
  let mediaClient: MediaClientService;
  let configClient: ConfigClientService;
  let albumsClient: AlbumsClientService;
  let adminClient: AdminClientService;
  let notificationsClient: NotificationsClientService;
  let batchesClient: BatchesClientService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        UsersClientService,
        TagsClientService,
        MediaClientService,
        ConfigClientService,
        AlbumsClientService,
        AdminClientService,
        NotificationsClientService,
        BatchesClientService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CLIENT_API_BASE_URL, useValue: 'http://api.example.test' }
      ]
    });

    usersClient = TestBed.inject(UsersClientService);
    tagsClient = TestBed.inject(TagsClientService);
    mediaClient = TestBed.inject(MediaClientService);
    configClient = TestBed.inject(ConfigClientService);
    albumsClient = TestBed.inject(AlbumsClientService);
    adminClient = TestBed.inject(AdminClientService);
    notificationsClient = TestBed.inject(NotificationsClientService);
    batchesClient = TestBed.inject(BatchesClientService);
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
    const updateMePromise = firstValueFrom(usersClient.updateMe({ show_nsfw: true, tag_confidence_threshold: 0.7 }));
    const tagsPromise = firstValueFrom(tagsClient.list({ after: 'tag-cursor-1', page_size: 10, category: 4, q: 'fox', sort_by: 'name', sort_order: 'asc' }));
    const deleteTagPromise = firstValueFrom(tagsClient.removeTagFromMedia(42));
    const trashTagPromise = firstValueFrom(tagsClient.trashMediaByTag(42));
    const deleteCharacterPromise = firstValueFrom(tagsClient.removeCharacterNameFromMedia('ayanami_rei'));
    const trashCharacterPromise = firstValueFrom(tagsClient.trashMediaByCharacterName('ayanami_rei'));

    const meRequest = expectRequest('GET', 'http://api.example.test/me');
    meRequest.flush({ id: 'user-1' });

    const updateMeRequest = expectRequest('PATCH', 'http://api.example.test/me');
    expect(updateMeRequest.request.body).toEqual({ show_nsfw: true, tag_confidence_threshold: 0.7 });
    updateMeRequest.flush({ id: 'user-1', show_nsfw: true, tag_confidence_threshold: 0.7 });

    const tagsRequest = expectRequest('GET', 'http://api.example.test/tags?after=tag-cursor-1&page_size=10&category=4&q=fox&sort_by=name&sort_order=asc');
    tagsRequest.flush({ total: 1, next_cursor: null, has_more: false, page_size: 10, items: [{ id: 1, name: 'fox' }] });

    const deleteTagRequest = expectRequest('POST', 'http://api.example.test/tags/42/actions/remove-from-media');
    expect(deleteTagRequest.request.body).toEqual({});
    deleteTagRequest.flush({ matched_media: 1, updated_media: 1, trashed_media: 0, already_trashed: 0, deleted_tag: true });

    const trashTagRequest = expectRequest('POST', 'http://api.example.test/tags/42/actions/trash-media');
    expect(trashTagRequest.request.body).toEqual({});
    trashTagRequest.flush({ matched_media: 2, updated_media: 0, trashed_media: 1, already_trashed: 1, deleted_tag: false });

    const deleteCharacterRequest = expectRequest('POST', 'http://api.example.test/character-names/ayanami_rei/actions/remove-from-media');
    expect(deleteCharacterRequest.request.body).toEqual({});
    deleteCharacterRequest.flush({ matched_media: 1, updated_media: 1, trashed_media: 0, already_trashed: 0, deleted_tag: false });

    const trashCharacterRequest = expectRequest('POST', 'http://api.example.test/character-names/ayanami_rei/actions/trash-media');
    expect(trashCharacterRequest.request.body).toEqual({});
    trashCharacterRequest.flush({ matched_media: 1, updated_media: 0, trashed_media: 1, already_trashed: 0, deleted_tag: false });

    await expect(mePromise).resolves.toEqual({ id: 'user-1' });
    await expect(updateMePromise).resolves.toEqual({ id: 'user-1', show_nsfw: true, tag_confidence_threshold: 0.7 });
    await expect(tagsPromise).resolves.toMatchObject({ items: [{ id: 1, name: 'fox' }] });
    await expect(deleteTagPromise).resolves.toMatchObject({ deleted_tag: true });
    await expect(trashTagPromise).resolves.toMatchObject({ trashed_media: 1, already_trashed: 1 });
    await expect(deleteCharacterPromise).resolves.toMatchObject({ updated_media: 1 });
    await expect(trashCharacterPromise).resolves.toMatchObject({ trashed_media: 1 });
  });

  it('builds media upload payloads and media query params correctly', async () => {
    const uploadPromise = firstValueFrom(mediaClient.uploadMedia([
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' })
    ]));
    const progressEvents: number[] = [];
    mediaClient.uploadMediaWithProgress([
      new File(['c'], 'c.png', { type: 'image/png' })
    ]).subscribe((event) => {
      progressEvents.push(event.type);
    });
    const listPromise = firstValueFrom(mediaClient.searchMedia({
      after: 'cursor-abc',
      page_size: 25,
      album_id: 'album-9',
      favorited: true,
      character_name: 'rin',
      media_type: ['image', 'video'],
      status: 'done,failed',
      captured_after: '2026-03-21T00:00:00.000Z'
    }));
    const suggestionsPromise = firstValueFrom(mediaClient.listCharacterSuggestions({ q: 'aya', limit: 5 }));

    const uploadRequests = httpTesting.match((request) => request.method === 'POST' && request.urlWithParams === 'http://api.example.test/media');
    expect(uploadRequests).toHaveLength(2);

    const uploadRequest = uploadRequests[0];
    expect(uploadRequest.request.body instanceof FormData).toBe(true);
    const files = uploadRequest.request.body.getAll('files') as File[];
    expect(files.map((file) => file.name)).toEqual(['a.png', 'b.png']);
    uploadRequest.flush({ accepted: 2, duplicates: 0, errors: 0, results: [] });

    const progressUploadRequest = uploadRequests[1];
    expect(progressUploadRequest.request.reportProgress).toBe(true);
    progressUploadRequest.event({ type: HttpEventType.UploadProgress, loaded: 1, total: 2 });
    progressUploadRequest.flush({ accepted: 1, duplicates: 0, errors: 0, results: [] });

    const listRequest = expectRequest('GET', 'http://api.example.test/media/search?after=cursor-abc&page_size=25&album_id=album-9&favorited=true&character_name=rin&media_type=image&media_type=video&status=done,failed&captured_after=2026-03-21T00:00:00.000Z');
    listRequest.flush({ total: 0, next_cursor: null, page_size: 25, items: [] });

    const suggestionsRequest = expectRequest('GET', 'http://api.example.test/media/character-suggestions?q=aya&limit=5');
    suggestionsRequest.flush([{ name: 'ayanami_rei', media_count: 2 }]);

    await expect(uploadPromise).resolves.toMatchObject({ accepted: 2 });
    await expect(listPromise).resolves.toMatchObject({ total: 0, items: [] });
    await expect(suggestionsPromise).resolves.toEqual([{ name: 'ayanami_rei', media_count: 2 }]);
    expect(progressEvents).toContain(HttpEventType.UploadProgress);
  });

  it('maps configuration requests to the config endpoint group', async () => {
    const uploadConfigPromise = firstValueFrom(configClient.getUploadConfig());

    const uploadConfigRequest = expectRequest('GET', 'http://api.example.test/config/upload');
    uploadConfigRequest.flush({ max_batch_size: 300, max_upload_size_mb: 50 });

    await expect(uploadConfigPromise).resolves.toEqual({ max_batch_size: 300, max_upload_size_mb: 50 });
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
    const posterPromise = firstValueFrom(mediaClient.getMediaPoster('media-1'));
    const purgeMediaPromise = firstValueFrom(mediaClient.purgeMedia('media-1'));
    const batchPurgePromise = firstValueFrom(mediaClient.batchPurgeMedia({ media_ids: ['m5'] }));

    const patchRequests = httpTesting.match(
      (request) => request.method === 'PATCH' && request.urlWithParams === 'http://api.example.test/media'
    );
    expect(patchRequests).toHaveLength(1);
    expect(patchRequests[0].request.body).toEqual({
      media_ids: ['m1', 'm2'],
      favorited: true
    });
    patchRequests[0].flush({ processed: 2, skipped: 0 });

    const emptyTrashRequest = expectRequest('POST', 'http://api.example.test/media/actions/empty-trash');
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

    const posterRequest = expectRequest('GET', 'http://api.example.test/media/media-1/poster');
    expect(posterRequest.request.responseType).toBe('blob');
    posterRequest.flush(new Blob(['poster']));

    const purgeMediaRequest = expectRequest('DELETE', 'http://api.example.test/media/media-1/purge');
    purgeMediaRequest.flush(null, { status: 204, statusText: 'No Content' });

    const batchPurgeRequest = expectRequest('POST', 'http://api.example.test/media/actions/purge');
    expect(batchPurgeRequest.request.body).toEqual({ media_ids: ['m5'] });
    batchPurgeRequest.flush({ processed: 1, skipped: 0 });

    await expect(batchUpdatePromise).resolves.toEqual({ processed: 2, skipped: 0 });
    await expect(emptyTrashPromise).resolves.toBeNull();
    await expect(getMediaPromise).resolves.toEqual({ id: 'media-1' });
    await expect(updateMediaPromise).resolves.toEqual({ id: 'media-1', favorited: true });
    await expect(deleteMediaPromise).resolves.toBeNull();
    await expect(queueTaggingJobPromise).resolves.toEqual({ queued: 1 });
    await expect(mediaFilePromise).resolves.toBeInstanceOf(Blob);
    await expect(thumbnailPromise).resolves.toBeInstanceOf(Blob);
    await expect(posterPromise).resolves.toBeInstanceOf(Blob);
    await expect(purgeMediaPromise).resolves.toBeNull();
    await expect(batchPurgePromise).resolves.toEqual({ processed: 1, skipped: 0 });
  });

  it('uses delete bodies and blob downloads for media and albums', async () => {
    const mediaDeletePromise = firstValueFrom(mediaClient.batchDeleteMedia({ media_ids: ['m1', 'm2'] }));
    const mediaDownloadPromise = firstValueFrom(mediaClient.downloadMedia({ media_ids: ['m1'] }));
    const listAlbumsPromise = firstValueFrom(albumsClient.listAlbums({ after: 'album-cursor-1', page_size: 20, sort_by: 'name', sort_order: 'asc' }));
    const createAlbumPromise = firstValueFrom(albumsClient.createAlbum({ name: 'Favorites' }));
    const getAlbumPromise = firstValueFrom(albumsClient.getAlbum('album-1'));
    const updateAlbumPromise = firstValueFrom(albumsClient.updateAlbum('album-1', { name: 'Road Trip' }));
    const deleteAlbumPromise = firstValueFrom(albumsClient.deleteAlbum('album-2'));
    const listAlbumMediaPromise = firstValueFrom(albumsClient.listAlbumMedia('album-1', { after: 'cursor-2', page_size: 12 }));
    const addMediaPromise = firstValueFrom(albumsClient.addMediaToAlbum('album-1', { media_ids: ['m1', 'm2'] }));
    const albumRemovePromise = firstValueFrom(albumsClient.removeMediaFromAlbum('album-1', { media_ids: ['m1'] }));
    const shareAlbumPromise = firstValueFrom(albumsClient.shareAlbum('album-1', { user_id: 'user-2', role: 'editor' }));
    const revokeSharePromise = firstValueFrom(albumsClient.revokeShare('album-1', 'user-2'));
    const albumDownloadPromise = firstValueFrom(albumsClient.downloadAlbum('album-1'));

    const mediaDeleteRequest = expectRequest('POST', 'http://api.example.test/media/actions/delete');
    expect(mediaDeleteRequest.request.body).toEqual({ media_ids: ['m1', 'm2'] });
    mediaDeleteRequest.flush({ processed: 2, skipped: 0 });

    const mediaDownloadRequest = expectRequest('POST', 'http://api.example.test/media/download');
    expect(mediaDownloadRequest.request.responseType).toBe('blob');
    mediaDownloadRequest.flush(new Blob(['zip']));

    const listAlbumsRequest = expectRequest('GET', 'http://api.example.test/albums?after=album-cursor-1&page_size=20&sort_by=name&sort_order=asc');
    listAlbumsRequest.flush({ total: 1, next_cursor: null, has_more: false, page_size: 20, items: [{ id: 'album-1' }] });

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

    const listAlbumMediaRequest = expectRequest('GET', 'http://api.example.test/albums/album-1/media?after=cursor-2&page_size=12');
    listAlbumMediaRequest.flush({ total: 1, next_cursor: null, page_size: 12, items: [] });

    const addMediaRequest = expectRequest('PUT', 'http://api.example.test/albums/album-1/media');
    expect(addMediaRequest.request.body).toEqual({ media_ids: ['m1', 'm2'] });
    addMediaRequest.flush({ processed: 2, skipped: 0 });

    const albumRemoveRequest = expectRequest('DELETE', 'http://api.example.test/albums/album-1/media');
    expect(albumRemoveRequest.request.body).toEqual({ media_ids: ['m1'] });
    albumRemoveRequest.flush({ processed: 1, skipped: 0 });

    const shareAlbumRequest = expectRequest('POST', 'http://api.example.test/albums/album-1/shares');
    expect(shareAlbumRequest.request.body).toEqual({ user_id: 'user-2', role: 'editor' });
    shareAlbumRequest.flush({ user_id: 'user-2', role: 'editor', shared_at: '2026-03-21T00:00:00Z', shared_by_user_id: 'user-1' });

    const revokeShareRequest = expectRequest('DELETE', 'http://api.example.test/albums/album-1/shares/user-2');
    revokeShareRequest.flush(null, { status: 204, statusText: 'No Content' });

    const albumDownloadRequest = expectRequest('GET', 'http://api.example.test/albums/album-1/download');
    expect(albumDownloadRequest.request.responseType).toBe('blob');
    albumDownloadRequest.flush(new Blob(['zip']));

    await expect(mediaDeletePromise).resolves.toEqual({ processed: 2, skipped: 0 });
    await expect(mediaDownloadPromise).resolves.toBeInstanceOf(Blob);
    await expect(listAlbumsPromise).resolves.toMatchObject({ total: 1, items: [{ id: 'album-1' }] });
    await expect(createAlbumPromise).resolves.toEqual({ id: 'album-2', name: 'Favorites' });
    await expect(getAlbumPromise).resolves.toEqual({ id: 'album-1' });
    await expect(updateAlbumPromise).resolves.toEqual({ id: 'album-1', name: 'Road Trip' });
    await expect(deleteAlbumPromise).resolves.toBeNull();
    await expect(listAlbumMediaPromise).resolves.toMatchObject({ total: 1, next_cursor: null, page_size: 12, items: [] });
    await expect(addMediaPromise).resolves.toEqual({ processed: 2, skipped: 0 });
    await expect(albumRemovePromise).resolves.toEqual({ processed: 1, skipped: 0 });
    await expect(shareAlbumPromise).resolves.toEqual({ user_id: 'user-2', role: 'editor', shared_at: '2026-03-21T00:00:00Z', shared_by_user_id: 'user-1' });
    await expect(revokeSharePromise).resolves.toBeNull();
    await expect(albumDownloadPromise).resolves.toBeInstanceOf(Blob);
  });

  it('maps admin requests and preserves query names', async () => {
    const statsPromise = firstValueFrom(adminClient.getStats());
    const listUsersPromise = firstValueFrom(adminClient.listUsers({ page: 2, page_size: 40, sort_by: 'username', sort_order: 'asc' }));
    const userDetailPromise = firstValueFrom(adminClient.getUserDetail('user-2'));
    const updateUserPromise = firstValueFrom(adminClient.updateUser('user-2', { is_admin: true }));
    const deleteUserPromise = firstValueFrom(adminClient.deleteUser('user-2', true));
    const queuePromise = firstValueFrom(adminClient.queueUserTaggingJobs('user-2'));
    const listAnnouncementsPromise = firstValueFrom(adminClient.listAnnouncements());
    const createAnnouncementPromise = firstValueFrom(adminClient.createAnnouncement({ title: 'Heads up', message: 'Deployment tonight' }));

    const statsRequest = expectRequest('GET', 'http://api.example.test/admin/stats');
    statsRequest.flush({
      total_users: 1,
      total_media: 2,
      total_storage_bytes: 3,
      pending_tagging: 4,
      failed_tagging: 5,
      trashed_media: 6
    });

    const listUsersRequest = expectRequest('GET', 'http://api.example.test/admin/users?page=2&page_size=40&sort_by=username&sort_order=asc');
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

    const listAnnouncementsRequest = expectRequest('GET', 'http://api.example.test/admin/announcements');
    listAnnouncementsRequest.flush([{ id: 'a1', title: 'Heads up', message: 'Deployment tonight', severity: 'info' }]);

    const createAnnouncementRequest = expectRequest('POST', 'http://api.example.test/admin/announcements');
    expect(createAnnouncementRequest.request.body).toEqual({ title: 'Heads up', message: 'Deployment tonight' });
    createAnnouncementRequest.flush({ id: 'a2', title: 'Heads up', message: 'Deployment tonight', severity: 'info' });

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
    await expect(listAnnouncementsPromise).resolves.toEqual([{ id: 'a1', title: 'Heads up', message: 'Deployment tonight', severity: 'info' }]);
    await expect(createAnnouncementPromise).resolves.toEqual({ id: 'a2', title: 'Heads up', message: 'Deployment tonight', severity: 'info' });
  });

  it('maps notifications requests to the /me/notifications endpoints', async () => {
    const listPromise = firstValueFrom(notificationsClient.list({ after: 'notif-cursor', page_size: 20, is_read: false }));
    const markReadPromise = firstValueFrom(notificationsClient.markRead('n1'));
    const markAllReadPromise = firstValueFrom(notificationsClient.markAllRead());
    const deletePromise = firstValueFrom(notificationsClient.delete('n2'));

    const listRequest = expectRequest('GET', 'http://api.example.test/me/notifications?after=notif-cursor&page_size=20&is_read=false');
    listRequest.flush({ total: 1, next_cursor: null, has_more: false, page_size: 20, items: [{ id: 'n1' }] });

    const markReadRequest = expectRequest('PATCH', 'http://api.example.test/me/notifications/n1/read');
    expect(markReadRequest.request.body).toEqual({});
    markReadRequest.flush({ id: 'n1', is_read: true });

    const markAllReadRequest = expectRequest('POST', 'http://api.example.test/me/notifications/read-all');
    markAllReadRequest.flush(null, { status: 204, statusText: 'No Content' });

    const deleteRequest = expectRequest('DELETE', 'http://api.example.test/me/notifications/n2');
    deleteRequest.flush(null, { status: 204, statusText: 'No Content' });

    await expect(listPromise).resolves.toMatchObject({ total: 1, items: [{ id: 'n1' }] });
    await expect(markReadPromise).resolves.toEqual({ id: 'n1', is_read: true });
    await expect(markAllReadPromise).resolves.toBeNull();
    await expect(deletePromise).resolves.toBeNull();
  });

  it('maps import batch requests to the /me/import-batches endpoints', async () => {
    const listPromise = firstValueFrom(batchesClient.list({ after: 'b-cursor', page_size: 10 }));
    const getPromise = firstValueFrom(batchesClient.get('b1'));
    const listItemsPromise = firstValueFrom(batchesClient.listItems('b1', { after: 'i-cursor', page_size: 50 }));

    const listRequest = expectRequest('GET', 'http://api.example.test/me/import-batches?after=b-cursor&page_size=10');
    listRequest.flush({ total: 1, next_cursor: null, has_more: false, page_size: 10, items: [{ id: 'b1' }] });

    const getRequest = expectRequest('GET', 'http://api.example.test/me/import-batches/b1');
    getRequest.flush({ id: 'b1', status: 'done' });

    const listItemsRequest = expectRequest('GET', 'http://api.example.test/me/import-batches/b1/items?after=i-cursor&page_size=50');
    listItemsRequest.flush({ total: 1, next_cursor: null, has_more: false, page_size: 50, items: [{ id: 'bi1' }] });

    await expect(listPromise).resolves.toMatchObject({ total: 1, items: [{ id: 'b1' }] });
    await expect(getPromise).resolves.toEqual({ id: 'b1', status: 'done' });
    await expect(listItemsPromise).resolves.toMatchObject({ total: 1, items: [{ id: 'bi1' }] });
  });

  it('includes ocr_text in media list query and ocr_text_override in update payload', async () => {
    const listPromise = firstValueFrom(mediaClient.searchMedia({ ocr_text: 'hello world', page_size: 10 }));
    const updatePromise = firstValueFrom(mediaClient.updateMedia('media-ocr', { ocr_text_override: 'Invoice $42' }));
    const clearPromise = firstValueFrom(mediaClient.updateMedia('media-ocr', { ocr_text_override: null }));

    const listRequest = expectRequest('GET', 'http://api.example.test/media/search?ocr_text=hello%20world&page_size=10');
    listRequest.flush({ total: 1, next_cursor: null, page_size: 10, items: [{ id: 'media-ocr', ocr_text: 'hello world' }] });

    const patchRequests = httpTesting.match(
      (req) => req.method === 'PATCH' && req.urlWithParams === 'http://api.example.test/media/media-ocr'
    );
    expect(patchRequests[0].request.body).toEqual({ ocr_text_override: 'Invoice $42' });
    patchRequests[0].flush({ id: 'media-ocr', ocr_text_override: 'Invoice $42', deleted_at: null });
    expect(patchRequests[1].request.body).toEqual({ ocr_text_override: null });
    patchRequests[1].flush({ id: 'media-ocr', ocr_text_override: null, deleted_at: null });

    await expect(listPromise).resolves.toMatchObject({ total: 1 });
    await expect(updatePromise).resolves.toMatchObject({ ocr_text_override: 'Invoice $42' });
    await expect(clearPromise).resolves.toMatchObject({ ocr_text_override: null });
  });
});
