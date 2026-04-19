import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MediaClientService } from '../../services/web/media-client.service';
import { TagsClientService } from '../../services/web/tags-client.service';
import { GalleryStore } from '../../services/gallery.store';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { AuthStore } from '../../services/web/auth.store';
import { ThemeService } from '../../services/theme.service';
import { BrowseComponent } from './browse.component';
import { of } from 'rxjs';
import { MediaListState, MediaVisibility } from '../../models/media';
import { describe, expect, it, vi } from 'vitest';

describe('BrowseComponent', () => {
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
        seriesName: null,
        ocrText: null,
        advanced: {
          excludeTags: [],
          mode: null,
          nsfw: null,
          sensitive: null,
          status: null,
          favorited: null,
          visibility: null,
          ownerUsername: null,
          uploaderUsername: null,
          mediaTypes: [],
          sortBy: null,
          sortOrder: null,
          capturedYear: null,
          capturedMonth: null,
          capturedDay: null,
          capturedAfter: null,
          capturedBefore: null,
          capturedBeforeYear: null,
          uploadedYear: null,
          uploadedMonth: null,
          uploadedDay: null,
          uploadedAfter: null,
          uploadedBefore: null,
          uploadedBeforeYear: null,
        },
      }),
      advancedFilters: () => ({
        excludeTags: [],
        mode: null,
        nsfw: null,
        sensitive: null,
        status: null,
        favorited: null,
        visibility: null,
        ownerUsername: null,
        uploaderUsername: null,
        mediaTypes: [],
        sortBy: null,
        sortOrder: null,
        capturedYear: null,
        capturedMonth: null,
        capturedDay: null,
        capturedAfter: null,
        capturedBefore: null,
        capturedBeforeYear: null,
        uploadedYear: null,
        uploadedMonth: null,
        uploadedDay: null,
        uploadedAfter: null,
        uploadedBefore: null,
        uploadedBeforeYear: null,
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
      imports: [BrowseComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: GalleryStore, useValue: galleryStore },
        {
          provide: MediaClientService,
          useValue: {
            search: () => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 100 }),
            getCharacterSuggestions: () => of([]),
          },
        },
        { provide: NavbarSearchService, useValue: searchService },
        { provide: TagsClientService, useValue: { list: () => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 6 }) } },
        { provide: ThemeService, useValue: { preference: () => 'system', cycle: () => {} } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(BrowseComponent);
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
