import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CLIENT_API_BASE_URL } from './api.config';
import { AUTH_MODE } from './auth.interceptor';
import { ClientApiService } from './api.service';

describe('ClientApiService', () => {
  let service: ClientApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ClientApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CLIENT_API_BASE_URL, useValue: 'http://api.example.test/' }
      ]
    });

    service = TestBed.inject(ClientApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('builds query params and omits nullish values', async () => {
    const requestPromise = firstValueFrom(service.get('/media', {
      query: {
        page: 2,
        page_size: 50,
        favorited: false,
        tags: 'cat,fox',
        status: undefined,
        exclude_tags: null
      }
    }));

    const request = httpTesting.expectOne('http://api.example.test/media?page=2&page_size=50&favorited=false&tags=cat,fox');
    expect(request.request.context.get(AUTH_MODE)).toBe('required');

    request.flush({ ok: true });

    await expect(requestPromise).resolves.toEqual({ ok: true });
  });

  it('marks auth-free requests in the context', async () => {
    const requestPromise = firstValueFrom(service.post('/auth/login', { username: 'admin' }, { auth: 'none' }));

    const request = httpTesting.expectOne('http://api.example.test/auth/login');
    expect(request.request.context.get(AUTH_MODE)).toBe('none');

    request.flush({ ok: true });

    await expect(requestPromise).resolves.toEqual({ ok: true });
  });

  it('sets explicit basic auth headers when requested', async () => {
    const requestPromise = firstValueFrom(service.get('/users/me', {
      basicAuth: { username: 'admin', password: 'admin' }
    }));

    const request = httpTesting.expectOne('http://api.example.test/users/me');
    expect(request.request.headers.get('Authorization')).toBe('Basic YWRtaW46YWRtaW4=');

    request.flush({ ok: true });

    await expect(requestPromise).resolves.toEqual({ ok: true });
  });

  it('requests blobs for binary downloads', async () => {
    const requestPromise = firstValueFrom(service.getBlob('/media/file'));

    const request = httpTesting.expectOne('http://api.example.test/media/file');
    expect(request.request.responseType).toBe('blob');

    const blob = new Blob(['payload'], { type: 'application/octet-stream' });
    request.flush(blob);

    await expect(requestPromise).resolves.toEqual(blob);
  });
});
