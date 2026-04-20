import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { FavoritesComponent } from './favorites.component';
import { GalleryStore } from '../../services/gallery.store';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { AuthStore } from '../../services/web/auth.store';
import { MediaClientService } from '../../services/web/media-client.service';
import { TagsClientService } from '../../services/web/tags-client.service';
import { ThemeService } from '../../services/theme.service';
import { describe, expect, it, vi } from 'vitest';

describe('FavoritesComponent', () => {
  it('renders the stories rail and forces favorited params', async () => {
    const galleryStore = {
      setParams: vi.fn(),
      load: vi.fn(() => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 })),
      loadTimeline: vi.fn(() => of({ buckets: [] })),
      loadMore: vi.fn(() => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 20 })),
      clearOptimisticItems: vi.fn(),
      groupedByDay: () => [],
      timeline: () => [],
      loading: () => false,
      hasMore: () => false,
    };
    const searchService = {
      draftText: () => '',
      draftChips: () => [],
      applied: () => ({ tags: [], characterNames: [], seriesNames: [], ocrText: null, advanced: {} }),
      advancedFilters: () => ({ characterMode: null, seriesMode: null }),
      activeAdvancedFilterCount: () => 0,
      appliedParams: () => ({ tag: ['memories'], favorited: false }),
      setText: vi.fn(),
      addTag: vi.fn(),
      addCharacter: vi.fn(),
      addSeries: vi.fn(),
      setOcr: vi.fn(),
      setAdvancedFilters: vi.fn(),
      removeChip: vi.fn(),
      removeLastChip: vi.fn(),
      apply: vi.fn(),
      clear: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [FavoritesComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: GalleryStore, useValue: galleryStore },
        {
          provide: MediaClientService,
          useValue: {
            search: () => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 100 }),
          },
        },
        { provide: NavbarSearchService, useValue: searchService },
        { provide: TagsClientService, useValue: { list: () => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 6 }) } },
        { provide: ThemeService, useValue: { preference: () => 'system', cycle: () => {} } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(FavoritesComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('zukan-media-browser')).not.toBeNull();
    expect(galleryStore.setParams).toHaveBeenCalledWith({
      tag: ['memories'],
      favorited: true,
      state: 'active',
    });
  });
});
