import { BreakpointObserver } from '@angular/cdk/layout';
import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { MediaNavigator } from '../../services/media-navigator.service';
import { BehaviorSubject, EMPTY, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaType, ProcessingStatus, TaggingStatus } from '../../models/media';
import { GalleryStore } from '../../services/gallery.store';
import { MediaService } from '../../services/media.service';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { TagsClientService } from '../../services/web/tags-client.service';
import { MediaInspectorPageComponent } from './media-inspector-page.component';

function makeMedia(id: string) {
  return {
    id,
    filename: `${id}.jpg`,
    original_filename: `${id}-original.jpg`,
    media_type: MediaType.IMAGE,
    metadata: {
      file_size: 100,
      width: 1200,
      height: 800,
      duration_seconds: null,
      frame_count: null,
      mime_type: 'image/jpeg',
      captured_at: '2026-03-28T12:00:00Z',
    },
    version: 1,
    uploaded_at: '2026-03-28T12:00:00Z',
    deleted_at: null,
    tags: [],
    ocr_text_override: null,
    is_nsfw: false,
    is_sensitive: false,
    is_nsfw_override: null,
    is_sensitive_override: null,
    tagging_status: TaggingStatus.DONE,
    tagging_error: null,
    thumbnail_status: ProcessingStatus.DONE,
    poster_status: ProcessingStatus.NOT_APPLICABLE,
    ocr_text: null,
    is_favorited: false,
    favorite_count: 0,
    tag_details: [],
    external_refs: [],
    entities: [],
    related_posts: [],
  };
}

async function configure(routeMediaId = 'm1', feed: ReturnType<typeof makeMedia>[] = []) {
  const paramMap = new BehaviorSubject(convertToParamMap({ mediaId: routeMediaId }));
  const mediaService = {
    get: vi.fn((id: string) => of(makeMedia(id))),
    getSimilar: vi.fn(() =>
      of({ items: [{ ...makeMedia('s1'), similarity: 0.9 }], next_cursor: null, has_more: false, page_size: 40 }),
    ),
    getFileUrl: vi.fn((id: string) => of(`blob:${id}`)),
    getThumbnailUrl: vi.fn((id: string) => of(`blob:thumb:${id}`)),
    getPosterUrl: vi.fn((id: string) => of(`blob:poster:${id}`)),
    update: vi.fn((id: string, body: unknown) => of({ ...makeMedia(id), ...(body as object) })),
    getCharacterSuggestions: vi.fn(() => of([])),
    getSeriesSuggestions: vi.fn(() => of([])),
    getLibraryClassificationSuggestions: vi.fn(() => of({ suggested_characters: [], suggested_series: [] })),
    recordLibraryClassificationFeedbackBulk: vi.fn(() => of({ processed: 0, skipped: 0 })),
  };
  const galleryStore = {
    groupedByDay: signal([{ date: '2026-03-28', label: 'March 28, 2026', items: feed }]),
    loadAroundItem: vi.fn(() => EMPTY),
    patchExisting: vi.fn(),
    toggleFavorite: vi.fn((media) => of({ ...media, is_favorited: !media.is_favorited })),
  };
  const searchService = {
    suppressNextUrlSync: vi.fn(),
    addMetadataFilter: vi.fn(),
    toQueryParamsWithClears: vi.fn(() => ({ tag: ['saber'], character_name: null })),
  };

  await TestBed.configureTestingModule({
    imports: [MediaInspectorPageComponent, NoopAnimationsModule],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: paramMap.asObservable() } },
      { provide: MediaService, useValue: mediaService },
      { provide: GalleryStore, useValue: galleryStore },
      { provide: NavbarSearchService, useValue: searchService },
      { provide: TagsClientService, useValue: { list: vi.fn(() => of({ items: [] })) } },
      { provide: BreakpointObserver, useValue: { observe: vi.fn(() => of({ matches: false })) } },
    ],
  }).compileComponents();

  return { paramMap, mediaService, galleryStore, searchService };
}

describe('MediaInspectorPageComponent', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('loads a directly visited media route and renders the inspector', async () => {
    const { mediaService } = await configure('m1');

    const fixture = TestBed.createComponent(MediaInspectorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mediaService.get).toHaveBeenCalledWith('m1');
    expect(mediaService.getFileUrl).toHaveBeenCalledWith('m1');
    expect(fixture.nativeElement.textContent).toContain('m1.jpg');
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('blob:m1');
  });

  it('updates the active media when the route param changes', async () => {
    const { paramMap } = await configure('m1', [makeMedia('m1'), makeMedia('m2')]);

    const fixture = TestBed.createComponent(MediaInspectorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    paramMap.next(convertToParamMap({ mediaId: 'm2' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.activeMediaId()).toBe('m2');
    expect(fixture.nativeElement.textContent).toContain('m2.jpg');
  });

  it('replaces the history entry when stepping through the feed', async () => {
    await configure('m1', [makeMedia('m1'), makeMedia('m2')]);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(MediaInspectorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const next = fixture.nativeElement.querySelector('button[aria-label="Next media"]') as HTMLButtonElement;
    next.click();

    expect(navigateSpy).toHaveBeenCalledWith(
      ['/gallery', 'media', 'm2'],
      expect.objectContaining({ replaceUrl: true, queryParamsHandling: 'preserve' }),
    );
  });

  it('returns straight to the feed when Escape closes a chain of images', async () => {
    await configure('m1');
    const location = TestBed.inject(Location);
    vi.spyOn(location, 'getState').mockReturnValue({ mediaDepth: 3 });
    const goSpy = vi.spyOn(location, 'historyGo').mockImplementation(() => undefined);

    const fixture = TestBed.createComponent(MediaInspectorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(goSpy).toHaveBeenCalledWith(-3);
  });

  it('closes to the feed without history when there is no depth', async () => {
    await configure('m1');
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(MediaInspectorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(navigateSpy).toHaveBeenCalledWith(
      ['/gallery'],
      expect.objectContaining({ replaceUrl: true }),
    );
  });

  it('applies a metadata filter to the feed the image was opened from', async () => {
    const { searchService } = await configure('m1');
    vi.spyOn(TestBed.inject(MediaNavigator), 'feedPath').mockReturnValue('/favorites');
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(MediaInspectorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.onMetadataFilterSelected({ type: 'tag', value: 'saber' });

    expect(searchService.suppressNextUrlSync).toHaveBeenCalled();
    expect(searchService.addMetadataFilter).toHaveBeenCalledWith('tag', 'saber');
    expect(navigateSpy).toHaveBeenCalledWith(['/favorites'], {
      queryParams: { tag: ['saber'] },
    });
  });

  it('applies a metadata filter to the gallery when no feed is underneath', async () => {
    await configure('m1');
    vi.spyOn(TestBed.inject(MediaNavigator), 'feedPath').mockReturnValue(null);
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(MediaInspectorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.onMetadataFilterSelected({ type: 'tag', value: 'saber' });

    expect(navigateSpy).toHaveBeenCalledWith(['/gallery'], {
      queryParams: { tag: ['saber'] },
    });
  });

  it('renders similar images and fetches the detail only once per image', async () => {
    const { mediaService } = await configure('m1');

    const fixture = TestBed.createComponent(MediaInspectorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mediaService.getSimilar).toHaveBeenCalledWith('m1', null);
    expect(fixture.nativeElement.querySelector('zukan-similar-media-grid')).not.toBeNull();
    expect(mediaService.get.mock.calls.filter(([id]) => id === 'm1').length).toBe(1);
  });

  it('pushes a deeper history entry when a similar image is selected', async () => {
    await configure('m1');
    const location = TestBed.inject(Location);
    vi.spyOn(location, 'getState').mockReturnValue({ mediaDepth: 2, mediaEntryKey: 'k2' });
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(MediaInspectorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.onRelatedPostSelected(makeMedia('s1'));

    expect(navigateSpy).toHaveBeenCalledWith(
      ['/gallery', 'media', 's1'],
      expect.objectContaining({
        replaceUrl: false,
        state: expect.objectContaining({ mediaDepth: 3 }),
      }),
    );
  });

  it('disables previous and next for direct loads without list context', async () => {
    await configure('m1');

    const fixture = TestBed.createComponent(MediaInspectorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const previous = fixture.nativeElement.querySelector('button[aria-label="Previous media"]') as HTMLButtonElement;
    const next = fixture.nativeElement.querySelector('button[aria-label="Next media"]') as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(true);
  });
});
