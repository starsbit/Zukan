import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CLIENT_API_BASE_URL } from './web/api.config';
import { TagsClientService } from './web/tags-client.service';
import { TagsService } from './tags.service';

describe('TagsService', () => {
  let service: TagsService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TagsService,
        TagsClientService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CLIENT_API_BASE_URL, useValue: 'http://api.example.test' }
      ]
    });

    service = TestBed.inject(TagsService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('caches tag searches by query', async () => {
    const firstSearch = firstValueFrom(service.search({ q: 'fox', limit: 10 }));
    const request = httpTesting.expectOne('http://api.example.test/tags?q=fox&limit=10');
    request.flush([{ id: 1, name: 'fox', category: 1, category_name: 'species', media_count: 2 }]);

    await expect(firstSearch).resolves.toHaveLength(1);
    expect(service.snapshot.tags).toHaveLength(1);

    const secondSearch = firstValueFrom(service.search({ q: 'fox', limit: 10 }));
    httpTesting.expectNone('http://api.example.test/tags?q=fox&limit=10');

    await expect(secondSearch).resolves.toHaveLength(1);
  });

  it('records search failures and can clear cached state', async () => {
    const searchPromise = firstValueFrom(service.search({ q: 'owl' }));
    const request = httpTesting.expectOne('http://api.example.test/tags?q=owl');
    request.flush({ detail: 'broken' }, { status: 500, statusText: 'Server Error' });

    await expect(searchPromise).rejects.toMatchObject({ status: 500 });
    expect(service.snapshot.request.error).toMatchObject({ status: 500 });
    expect(service.snapshot.activeQuery).toEqual({ q: 'owl' });

    service.clear();

    expect(service.snapshot.tags).toEqual([]);
    expect(service.snapshot.activeQuery).toBeNull();
    expect(service.snapshot.resultsByKey).toEqual({});
  });
});
