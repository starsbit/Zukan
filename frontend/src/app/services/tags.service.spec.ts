import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { EMPTY, firstValueFrom } from 'rxjs';

import { CLIENT_API_BASE_URL } from './web/api.config';
import { TagsClientService } from './web/tags-client.service';
import { TagsService } from './tags.service';

const forestTag = { id: 1, name: 'forest', category: 0, category_key: 'general', category_name: 'general', media_count: 2 };
const skyTag = { id: 2, name: 'sky', category: 0, category_key: 'general', category_name: 'general', media_count: 3 };

describe('TagsService', () => {
  let service: TagsService;
  let tagsClient: TagsClientService;
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
    tagsClient = TestBed.inject(TagsClientService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('caches tag searches by query', async () => {
    const firstSearch = firstValueFrom(service.search({ q: 'fox', page_size: 10 }));
    const request = httpTesting.expectOne('http://api.example.test/tags?q=fox&page_size=10');
    request.flush({ total: 1, page: 1, page_size: 10, items: [{ id: 1, name: 'fox', category: 1, category_name: 'species', media_count: 2 }] });

    await expect(firstSearch).resolves.toHaveLength(1);
    expect(service.snapshot.tags).toHaveLength(1);

    const secondSearch = firstValueFrom(service.search({ q: 'fox', page_size: 10 }));
    httpTesting.expectNone('http://api.example.test/tags?q=fox&page_size=10');

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

  it('deletes a tag and removes it from cached results', async () => {
    const searchPromise = firstValueFrom(service.search({ q: 'f' }));
    const searchRequest = httpTesting.expectOne('http://api.example.test/tags?q=f');
    searchRequest.flush({ total: 2, page: 1, page_size: 20, items: [forestTag, skyTag] });
    await expect(searchPromise).resolves.toEqual([forestTag, skyTag]);

    const deletePromise = firstValueFrom(service.deleteTag(1, 'forest'));
    expect(service.snapshot.mutationPending).toBe(true);

    const deleteRequest = httpTesting.expectOne('http://api.example.test/tags/1/actions/remove-from-media');
    expect(deleteRequest.request.method).toBe('POST');
    deleteRequest.flush({
      matched_media: 1,
      updated_media: 1,
      trashed_media: 0,
      already_trashed: 0,
      deleted_tag: true
    });

    await expect(deletePromise).resolves.toEqual({
      matched_media: 1,
      updated_media: 1,
      trashed_media: 0,
      already_trashed: 0,
      deleted_tag: true
    });
    expect(service.snapshot.tags).toEqual([skyTag]);
    expect(service.snapshot.resultsByKey[JSON.stringify({ q: 'f' })]).toEqual([skyTag]);
    expect(service.snapshot.mutationPending).toBe(false);
    expect(service.snapshot.mutationError).toBeNull();
  });

  it('maps tag and character management mutations and records failures', async () => {
    const trashTagPromise = firstValueFrom(service.trashMediaByTag(99));
    const trashTagRequest = httpTesting.expectOne('http://api.example.test/tags/99/actions/trash-media');
    expect(trashTagRequest.request.method).toBe('POST');
    expect(trashTagRequest.request.body).toEqual({});
    trashTagRequest.flush({
      matched_media: 4,
      updated_media: 0,
      trashed_media: 2,
      already_trashed: 2,
      deleted_tag: false
    });
    await expect(trashTagPromise).resolves.toMatchObject({ trashed_media: 2, already_trashed: 2 });

    const trashCharacterPromise = firstValueFrom(service.trashMediaByCharacterName('ayanami_rei'));
    const trashCharacterRequest = httpTesting.expectOne('http://api.example.test/character-names/ayanami_rei/actions/trash-media');
    expect(trashCharacterRequest.request.method).toBe('POST');
    trashCharacterRequest.flush({
      matched_media: 1,
      updated_media: 0,
      trashed_media: 1,
      already_trashed: 0,
      deleted_tag: false
    });
    await expect(trashCharacterPromise).resolves.toMatchObject({ trashed_media: 1 });

    const deleteCharacterSuccessPromise = firstValueFrom(service.deleteCharacterName('ikari_shinji'));
    const deleteCharacterSuccessRequest = httpTesting.expectOne('http://api.example.test/character-names/ikari_shinji/actions/remove-from-media');
    expect(deleteCharacterSuccessRequest.request.method).toBe('POST');
    deleteCharacterSuccessRequest.flush({
      matched_media: 1,
      updated_media: 1,
      trashed_media: 0,
      already_trashed: 0,
      deleted_tag: false
    });
    await expect(deleteCharacterSuccessPromise).resolves.toMatchObject({ updated_media: 1 });

    const deleteCharacterPromise = firstValueFrom(service.deleteCharacterName('ayanami_rei'));
    const deleteCharacterRequest = httpTesting.expectOne('http://api.example.test/character-names/ayanami_rei/actions/remove-from-media');
    expect(deleteCharacterRequest.request.method).toBe('POST');
    deleteCharacterRequest.flush({ detail: 'broken' }, { status: 500, statusText: 'Server Error' });
    await expect(deleteCharacterPromise).rejects.toMatchObject({ status: 500 });
    expect(service.snapshot.mutationError).toMatchObject({ status: 500 });
    expect(service.snapshot.mutationPending).toBe(false);

    const trashCharacterFailurePromise = firstValueFrom(service.trashMediaByCharacterName('shikinami_asuka')).catch((error) => error);
    const trashCharacterFailureRequest = httpTesting.expectOne('http://api.example.test/character-names/shikinami_asuka/actions/trash-media');
    trashCharacterFailureRequest.flush({ detail: 'still broken' }, { status: 400, statusText: 'Bad Request' });
    await expect(trashCharacterFailurePromise).resolves.toMatchObject({ status: 400 });
  });

  it('settles pending mutations even when the client completes without emitting', async () => {
    vi.spyOn(tagsClient, 'removeCharacterNameFromMedia').mockReturnValue(EMPTY);

    await new Promise<void>((resolve, reject) => {
      service.deleteCharacterName('quiet-complete').subscribe({
        complete: resolve,
        error: reject
      });
    });

    expect(service.snapshot.mutationPending).toBe(false);
  });
});
