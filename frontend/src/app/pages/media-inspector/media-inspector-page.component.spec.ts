import { BreakpointObserver } from '@angular/cdk/layout';
import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../models/media';
import { GalleryStore } from '../../services/gallery.store';
import { MediaInspectionContextService } from '../../services/media-inspection-context.service';
import { MediaService } from '../../services/media.service';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { TagsClientService } from '../../services/web/tags-client.service';
import { MediaInspectorPageComponent } from './media-inspector-page.component';

function makeMedia(id: string) {
  return {
    id,
    uploader_id: 'u1',
    uploader_username: 'admin',
    owner_id: 'u1',
    owner_username: 'admin',
    visibility: MediaVisibility.PRIVATE,
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

async function configure(routeMediaId = 'm1') {
  const paramMap = new BehaviorSubject(convertToParamMap({ mediaId: routeMediaId }));
  const mediaService = {
    get: vi.fn((id: string) => of(makeMedia(id))),
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
    patchItem: vi.fn(),
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
    const { paramMap } = await configure('m1');
    const context = TestBed.inject(MediaInspectionContextService);
    context.setContext([makeMedia('m1'), makeMedia('m2')], '/gallery');

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

  it('routes to the next context item from the inspector', async () => {
    await configure('m1');
    const context = TestBed.inject(MediaInspectionContextService);
    context.setContext([makeMedia('m1'), makeMedia('m2')], '/gallery');
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(MediaInspectorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const next = fixture.nativeElement.querySelector('button[aria-label="Next media"]') as HTMLButtonElement;
    next.click();

    expect(navigateSpy).toHaveBeenCalledWith(['/media', 'm2']);
  });

  it('uses browser back navigation when Escape closes the routed inspector', async () => {
    await configure('m1');
    const location = TestBed.inject(Location);
    const backSpy = vi.spyOn(location, 'back').mockImplementation(() => undefined);

    const fixture = TestBed.createComponent(MediaInspectorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(backSpy).toHaveBeenCalled();
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
