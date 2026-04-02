import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MediaClientService } from '../../services/web/media-client.service';
import { TagsClientService } from '../../services/web/tags-client.service';
import { GalleryStore } from '../../services/gallery.store';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { AuthStore } from '../../services/web/auth.store';
import { ThemeService } from '../../services/theme.service';
import { HomeComponent } from './home.component';
import { of } from 'rxjs';
import { MediaListState, MediaVisibility } from '../../models/media';

describe('HomeComponent', () => {
  it('uses the shared layout and reacts to applied search params', async () => {
    const galleryStore = {
      setParams: vi.fn(),
      load: vi.fn(() => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 })),
      loadTimeline: vi.fn(() => of({ buckets: [] })),
      loadMore: vi.fn(() => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 })),
      clearOptimisticItems: vi.fn(),
      hasMore: () => false,
      loading: () => false,
      groupedByDay: () => [],
      timeline: () => [],
      items: () => [],
      total: () => 0,
    };
    const searchService = {
      draftText: () => '',
      draftChips: () => [],
      applied: () => ({
        tags: ['Saber'],
        characterName: null,
        ocrText: null,
        advanced: {
          excludeTags: [],
          mode: null,
          nsfw: null,
          status: null,
          favorited: null,
          visibility: null,
          mediaTypes: [],
          sortBy: null,
          sortOrder: null,
          capturedYear: null,
          capturedMonth: null,
          capturedDay: null,
          capturedAfter: null,
          capturedBefore: null,
          capturedBeforeYear: null,
        },
      }),
      advancedFilters: () => ({
        excludeTags: [],
        mode: null,
        nsfw: null,
        status: null,
        favorited: null,
        visibility: null,
        mediaTypes: [],
        sortBy: null,
        sortOrder: null,
        capturedYear: null,
        capturedMonth: null,
        capturedDay: null,
        capturedAfter: null,
        capturedBefore: null,
        capturedBeforeYear: null,
      }),
      activeAdvancedFilterCount: () => 0,
      appliedParams: () => ({ tag: ['Saber'] }),
      setText: vi.fn(),
      addTag: vi.fn(),
      setCharacter: vi.fn(),
      setOcr: vi.fn(),
      setAdvancedFilters: vi.fn(),
      removeChip: vi.fn(),
      removeLastChip: vi.fn(),
      apply: vi.fn(),
      clear: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: MediaClientService, useValue: { getCharacterSuggestions: () => of([]) } },
        { provide: NavbarSearchService, useValue: searchService },
        { provide: TagsClientService, useValue: { list: () => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 6 }) } },
        { provide: ThemeService, useValue: { preference: () => 'system', cycle: () => {} } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('zukan-layout')).not.toBeNull();
    expect(element.querySelector('zukan-navbar-brand')).not.toBeNull();
    expect(galleryStore.setParams).toHaveBeenCalledWith({
      tag: ['Saber'],
      state: MediaListState.ACTIVE,
      visibility: MediaVisibility.PUBLIC,
    });
  });
});
