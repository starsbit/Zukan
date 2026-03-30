import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { MediaListState } from '../../models/media';
import { AlbumStore } from '../../services/album.store';
import { GalleryStore } from '../../services/gallery.store';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { MediaClientService } from '../../services/web/media-client.service';
import { TagsClientService } from '../../services/web/tags-client.service';
import { AuthStore } from '../../services/web/auth.store';
import { ThemeService } from '../../services/theme.service';
import { GalleryComponent } from './gallery.component';

describe('GalleryComponent', () => {
  it('uses the shared layout and merges the shared search params', async () => {
    class FakeIntersectionObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    }

    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

    const galleryStore = {
      setParams: vi.fn(),
      load: vi.fn(() => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 })),
      loadTimeline: vi.fn(() => of({ buckets: [] })),
      loadMore: vi.fn(() => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 })),
      groupedByDay: () => [],
      timeline: () => [],
      loading: () => false,
      hasMore: () => false,
    };
    const searchService = {
      draftText: () => '',
      draftChips: () => [],
      applied: () => ({
        tags: [],
        characterName: 'Rin Tohsaka',
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
      appliedParams: () => ({ character_name: 'Rin Tohsaka' }),
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
      imports: [GalleryComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        {
          provide: AlbumStore,
          useValue: { items: () => [], loading: () => false, loaded: () => true, load: vi.fn(() => of([])), addMedia: vi.fn(() => of({ processed: 0, skipped: 0 })) },
        },
        { provide: GalleryStore, useValue: galleryStore },
        { provide: MatDialog, useValue: { open: vi.fn(() => ({ afterClosed: () => of(undefined) })) } },
        { provide: MediaClientService, useValue: { getCharacterSuggestions: () => of([]) } },
        { provide: NavbarSearchService, useValue: searchService },
        { provide: TagsClientService, useValue: { list: () => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 6 }) } },
        { provide: ThemeService, useValue: { preference: () => 'system', cycle: () => {} } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(GalleryComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('zukan-layout')).not.toBeNull();
    expect(element.querySelector('zukan-media-browser')).not.toBeNull();
    expect(galleryStore.setParams).toHaveBeenCalledWith({
      character_name: 'Rin Tohsaka',
      state: MediaListState.ACTIVE,
    });

    expect(galleryStore.load).toHaveBeenCalledTimes(1);
    expect(galleryStore.loadTimeline).toHaveBeenCalledTimes(1);
  });
});
