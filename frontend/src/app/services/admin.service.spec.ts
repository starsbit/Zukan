import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { CLIENT_API_BASE_URL } from './web/api.config';
import { AdminAccessError, AdminService } from './admin.service';
import { AdminClientService } from './web/admin-client.service';
import { AuthClientService } from './web/auth-client.service';
import { ClientAuthStore } from './web/auth.store';
import { UsersClientService } from './web/users-client.service';

describe('AdminService', () => {
  let service: AdminService;
  let authService: AuthService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AdminService,
        AuthService,
        AdminClientService,
        AuthClientService,
        ClientAuthStore,
        UsersClientService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CLIENT_API_BASE_URL, useValue: 'http://api.example.test' }
      ]
    });

    service = TestBed.inject(AdminService);
    authService = TestBed.inject(AuthService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  const expectRequest = (method: string, url: string) => httpTesting.expectOne(
    (request) => request.method === method && request.urlWithParams === url
  );

  it('allows admins to call admin endpoints', async () => {
    authService.setAuthenticatedUser({
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.test',
      is_admin: true,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    const resultPromise = firstValueFrom(service.getStats());

    const statsRequest = expectRequest('GET', 'http://api.example.test/admin/stats');
    statsRequest.flush({
      total_users: 1,
      total_media: 2,
      total_storage_bytes: 3,
      pending_tagging: 4,
      failed_tagging: 5,
      trashed_media: 6
    });

    await expect(resultPromise).resolves.toEqual({
      total_users: 1,
      total_media: 2,
      total_storage_bytes: 3,
      pending_tagging: 4,
      failed_tagging: 5,
      trashed_media: 6
    });
  });

  it('blocks non-admin users before the admin request is sent', async () => {
    authService.setAuthenticatedUser({
      id: 'user-1',
      username: 'user',
      email: 'user@example.test',
      is_admin: false,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    const resultPromise = firstValueFrom(service.listUsers({ page: 1, page_size: 20 }));

    httpTesting.expectNone('http://api.example.test/admin/users?page=1&page_size=20');

    await expect(resultPromise).rejects.toBeInstanceOf(AdminAccessError);
  });

  it('guards mutating admin operations too', async () => {
    authService.setAuthenticatedUser({
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.test',
      is_admin: true,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    const resultPromise = firstValueFrom(service.deleteUser('user-2', true));

    const deleteRequest = expectRequest('DELETE', 'http://api.example.test/admin/users/user-2?delete_media=true');
    deleteRequest.flush(null, { status: 204, statusText: 'No Content' });

    await expect(resultPromise).resolves.toBeNull();
  });

  it('patches cached users after admin updates', async () => {
    authService.setAuthenticatedUser({
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.test',
      is_admin: true,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    const listUsersPromise = firstValueFrom(service.listUsers({ page: 1, page_size: 20 }));
    const listRequest = expectRequest('GET', 'http://api.example.test/admin/users?page=1&page_size=20');
    listRequest.flush({
      total: 1,
      page: 1,
      page_size: 20,
      items: [{
        id: 'user-2',
        username: 'user',
        email: 'user@example.test',
        is_admin: false,
        show_nsfw: false,
        created_at: '2026-03-21T00:00:00Z'
      }]
    });
    await expect(listUsersPromise).resolves.toMatchObject({ total: 1 });

    const updatePromise = firstValueFrom(service.updateUser('user-2', { is_admin: true }));
    const updateRequest = expectRequest('PATCH', 'http://api.example.test/admin/users/user-2');
    updateRequest.flush({
      id: 'user-2',
      username: 'user',
      email: 'user@example.test',
      is_admin: true,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    await expect(updatePromise).resolves.toMatchObject({ is_admin: true });
    expect(service.snapshot.usersPage?.items[0]?.is_admin).toBe(true);
  });

  it('loads user detail and queues tagging jobs for admins', async () => {
    authService.setAuthenticatedUser({
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.test',
      is_admin: true,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    const detailPromise = firstValueFrom(service.getUserDetail('user-2'));
    const detailRequest = expectRequest('GET', 'http://api.example.test/admin/users/user-2');
    detailRequest.flush({
      id: 'user-2',
      username: 'user',
      email: 'user@example.test',
      is_admin: false,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z',
      media_count: 10,
      storage_used_bytes: 2048
    });

    await expect(detailPromise).resolves.toMatchObject({ media_count: 10 });
    expect(service.snapshot.selectedUserId).toBe('user-2');
    expect(service.snapshot.userDetails['user-2']?.storage_used_bytes).toBe(2048);

    const queuePromise = firstValueFrom(service.queueUserTaggingJobs('user-2'));
    const queueRequest = expectRequest('POST', 'http://api.example.test/admin/users/user-2/tagging-jobs');
    queueRequest.flush({ queued: 7 });

    await expect(queuePromise).resolves.toEqual({ queued: 7 });
    expect(service.snapshot.mutationPending).toBe(false);
  });

  it('refreshes stats after deleting a user when stats are already loaded', async () => {
    authService.setAuthenticatedUser({
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.test',
      is_admin: true,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    service['stateSubject'].next({
      ...service.snapshot,
      stats: {
        total_users: 2,
        total_media: 2,
        total_storage_bytes: 3,
        pending_tagging: 4,
        failed_tagging: 5,
        trashed_media: 6
      },
      usersPage: {
        total: 1,
        page: 1,
        page_size: 20,
        items: [{
          id: 'user-2',
          username: 'user',
          email: 'user@example.test',
          is_admin: false,
          show_nsfw: false,
          created_at: '2026-03-21T00:00:00Z'
        }]
      }
    });

    const deletePromise = firstValueFrom(service.deleteUser('user-2', false));
    const deleteRequest = expectRequest('DELETE', 'http://api.example.test/admin/users/user-2?delete_media=false');
    deleteRequest.flush(null, { status: 204, statusText: 'No Content' });

    const statsRequest = expectRequest('GET', 'http://api.example.test/admin/stats');
    statsRequest.flush({
      total_users: 1,
      total_media: 2,
      total_storage_bytes: 3,
      pending_tagging: 4,
      failed_tagging: 5,
      trashed_media: 6
    });

    await expect(deletePromise).resolves.toBeNull();
    expect(service.snapshot.usersPage?.total).toBe(0);
    expect(service.snapshot.stats?.total_users).toBe(1);
  });

  it('records request and mutation errors', async () => {
    authService.setAuthenticatedUser({
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.test',
      is_admin: true,
      show_nsfw: false,
      created_at: '2026-03-21T00:00:00Z'
    });

    const statsPromise = firstValueFrom(service.getStats());
    const statsRequest = expectRequest('GET', 'http://api.example.test/admin/stats');
    statsRequest.flush({ detail: 'broken' }, { status: 500, statusText: 'Server Error' });
    await expect(statsPromise).rejects.toMatchObject({ status: 500 });
    expect(service.snapshot.statsRequest.error).toMatchObject({ status: 500 });

    const updatePromise = firstValueFrom(service.updateUser('user-2', { is_admin: true }));
    const updateRequest = expectRequest('PATCH', 'http://api.example.test/admin/users/user-2');
    updateRequest.flush({ detail: 'broken' }, { status: 500, statusText: 'Server Error' });
    await expect(updatePromise).rejects.toMatchObject({ status: 500 });
    expect(service.snapshot.mutationError).toMatchObject({ status: 500 });
  });
});
