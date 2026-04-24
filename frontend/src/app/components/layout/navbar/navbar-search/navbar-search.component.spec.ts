import { BreakpointObserver } from '@angular/cdk/layout';
import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { MediaType } from '../../../../models/media';
import { NavbarSearchService } from '../../../../services/navbar-search.service';
import { TagsClientService } from '../../../../services/web/tags-client.service';
import { MediaClientService } from '../../../../services/web/media-client.service';
import { AuthStore } from '../../../../services/web/auth.store';
import { NavbarSearchComponent } from './navbar-search.component';

describe('NavbarSearchComponent', () => {
  function createBreakpointObserver() {
    const state$ = new BehaviorSubject({ matches: false, breakpoints: {} as Record<string, boolean> });
    return {
      observer: {
        observe: () => state$.asObservable(),
      },
      setMatches(matches: boolean) {
        state$.next({ matches, breakpoints: {} });
      },
    };
  }

  async function flushDebounce(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  async function setInputValue(
    fixture: ReturnType<typeof TestBed.createComponent<NavbarSearchComponent>>,
    element: HTMLElement,
    value: string,
  ): Promise<HTMLInputElement> {
    const input = element.querySelector('input') as HTMLInputElement;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await flushDebounce();
    await fixture.whenStable();
    fixture.detectChanges();
    return input;
  }

  async function createComponent(initialUrl = '/', initialQuery: Record<string, string | string[]> = {}) {
    const breakpoint = createBreakpointObserver();
    const routeQueryParamMap = new BehaviorSubject(convertToParamMap(initialQuery));
    const route = {
      queryParamMap: routeQueryParamMap.asObservable(),
      snapshot: {
        get queryParamMap() {
          return routeQueryParamMap.value;
        },
      },
    };
    const tagsList = vi.fn((params: { q?: string; scope?: string }) => of({
      items: params.q ? [{ id: 1, name: 'Saber', media_count: 10, category: 4, category_name: 'character', category_key: 'character' }] : [],
      total: 1,
      next_cursor: null,
      has_more: false,
      page_size: 6,
    }));
    const getCharacterSuggestions = vi.fn((query: string) => of(
      query ? [{ name: 'Rin Tohsaka', media_count: 4 }] : [],
    ));
    const getSeriesSuggestions = vi.fn((query: string) => of(
      query ? [{ name: 'Fate/stay night', media_count: 9 }] : [],
    ));
    await TestBed.configureTestingModule({
      imports: [NavbarSearchComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: BreakpointObserver, useValue: breakpoint.observer },
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        {
          provide: TagsClientService,
          useValue: {
            list: tagsList,
          },
        },
        {
          provide: MediaClientService,
          useValue: {
            getCharacterSuggestions,
            getSeriesSuggestions,
          },
        },
        NavbarSearchService,
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    Object.defineProperty(router, 'url', {
      configurable: true,
      get: () => initialUrl,
    });

    const fixture = TestBed.createComponent(NavbarSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return {
      fixture,
      component: fixture.componentInstance,
      element: fixture.nativeElement as HTMLElement,
      overlay: TestBed.inject(OverlayContainer).getContainerElement(),
      breakpoint,
      tagsList,
      getCharacterSuggestions,
      getSeriesSuggestions,
      searchService: TestBed.inject(NavbarSearchService),
      routeQueryParamMap,
      router: TestBed.inject(Router),
    };
  }

  it('uses owner-scoped suggestions outside browse and favorites', async () => {
    const { fixture, element, tagsList, getCharacterSuggestions, getSeriesSuggestions } = await createComponent('/gallery');

    await setInputValue(fixture, element, 'Sab');

    expect(tagsList).toHaveBeenCalledWith(expect.objectContaining({ q: 'Sab', scope: 'owner' }));
    expect(getCharacterSuggestions).toHaveBeenCalledWith('Sab', 6, 'owner');
    expect(getSeriesSuggestions).toHaveBeenCalledWith('Sab', 6, 'owner');
  });

  it('uses accessible suggestions on browse', async () => {
    const { fixture, element, tagsList, getCharacterSuggestions, getSeriesSuggestions } = await createComponent('/browse');

    await setInputValue(fixture, element, 'Sab');

    expect(tagsList).toHaveBeenCalledWith(expect.objectContaining({ q: 'Sab', scope: 'accessible' }));
    expect(getCharacterSuggestions).toHaveBeenCalledWith('Sab', 6, 'accessible');
    expect(getSeriesSuggestions).toHaveBeenCalledWith('Sab', 6, 'accessible');
  });

  it('creates a tag chip from a suggestion selection', async () => {
    const { fixture, element, overlay, searchService } = await createComponent();
    const input = await setInputValue(fixture, element, 'Sab');
    input.focus();
    input.dispatchEvent(new Event('focusin'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(overlay.textContent).toContain('Saber');
    const tagOption = Array.from(overlay.querySelectorAll('mat-option')).find((option) =>
      option.textContent?.includes('Saber'),
    ) as HTMLElement;
    tagOption.click();
    fixture.detectChanges();

    expect(searchService.draftChips()).toContainEqual({ type: 'tag', value: 'Saber' });
    expect(searchService.applied().tags).toEqual(['Saber']);
  });

  it('creates and accumulates character chips from suggestions', async () => {
    const { fixture, component, searchService } = await createComponent();

    component.onSuggestionSelected({ option: { value: { type: 'character', value: 'Rin Tohsaka' } } } as never);
    component.onSuggestionSelected({ option: { value: { type: 'character', value: 'Saber Alter' } } } as never);
    fixture.detectChanges();

    expect(searchService.draftChips().filter((chip) => chip.type === 'character')).toEqual([
      { type: 'character', value: 'Rin Tohsaka' },
      { type: 'character', value: 'Saber Alter' },
    ]);
  });

  it('creates and accumulates series chips from suggestions', async () => {
    const { fixture, component, searchService } = await createComponent();

    component.onSuggestionSelected({ option: { value: { type: 'series', value: 'Fate/zero' } } } as never);
    component.onSuggestionSelected({ option: { value: { type: 'series', value: 'Fate/stay night' } } } as never);
    fixture.detectChanges();

    expect(searchService.draftChips().filter((chip) => chip.type === 'series')).toEqual([
      { type: 'series', value: 'Fate/zero' },
      { type: 'series', value: 'Fate/stay night' },
    ]);
  });

  it('commits OCR text and applies search on enter', async () => {
    const { fixture, element, component, searchService } = await createComponent();
    const input = element.querySelector('input') as HTMLInputElement;

    input.value = 'unlimited blade works';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    component.onEnter(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    expect(searchService.draftChips()).toContainEqual({ type: 'ocr', value: 'unlimited blade works' });
    expect(searchService.applied().ocrText).toBe('unlimited blade works');
    expect(component.query.value).toBe('');
  });

  it('clears the search on escape', async () => {
    const { fixture, component, searchService } = await createComponent();

    searchService.addTag('Saber');
    searchService.apply();
    fixture.detectChanges();

    component.onEscape(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(searchService.draftChips()).toEqual([]);
    expect(searchService.applied()).toEqual({
      tags: [],
      characterNames: [],
      seriesNames: [],
      ocrText: null,
      advanced: {
        excludeTags: [],
        mode: null,
        characterMode: null,
        seriesMode: null,
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
        uploadedYear: null,
        uploadedMonth: null,
        uploadedDay: null,
        uploadedAfter: null,
        uploadedBefore: null,
        uploadedBeforeYear: null,
        capturedBeforeYear: null,
      },
    });
    expect(component.query.value).toBe('');
  });

  it('removes the last chip on backspace when text is empty', async () => {
    const { searchService, component } = await createComponent();

    searchService.addTag('Saber');
    searchService.setText('');
    component.query.setValue('', { emitEvent: false });
    component.onBackspace();

    expect(searchService.draftChips()).toEqual([]);
    expect(searchService.applied().tags).toEqual([]);
  });

  it('updates the applied search when removing a chip from the navbar', async () => {
    const { searchService, component } = await createComponent();

    searchService.addTag('Saber');
    searchService.addTag('Archer');

    component.onRemoveChip({ type: 'tag', value: 'Saber' });

    expect(searchService.applied().tags).toEqual(['Archer']);
  });

  it('hydrates search chips from route query params', async () => {
    const { searchService, element } = await createComponent('/gallery?tag=Saber&character_name=Rin%20Tohsaka', {
      tag: 'Saber',
      character_name: 'Rin Tohsaka',
      series_name: 'Fate/stay night',
    });

    expect(searchService.draftChips()).toEqual([
      { type: 'tag', value: 'Saber' },
      { type: 'character', value: 'Rin Tohsaka' },
      { type: 'series', value: 'Fate/stay night' },
    ]);
    expect(element.textContent).toContain('Saber');
    expect(element.textContent).toContain('Rin Tohsaka');
    expect(element.textContent).toContain('Fate/Stay Night');
  });

  it('writes canonical query params when search changes', async () => {
    const { fixture, searchService, router } = await createComponent();
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    searchService.addTag('Saber');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ tag: ['Saber'], character_name: null }),
        queryParamsHandling: 'merge',
      }),
    );
  });

  it('rehydrates when browser navigation changes query params', async () => {
    const { fixture, routeQueryParamMap, searchService } = await createComponent();

    routeQueryParamMap.next(convertToParamMap({ tag: 'Archer', ocr_text: 'moon' }));
    fixture.detectChanges();

    expect(searchService.draftChips()).toEqual([
      { type: 'tag', value: 'Archer' },
      { type: 'ocr', value: 'moon' },
    ]);
    expect(searchService.appliedParams()).toEqual({ tag: ['Archer'], ocr_text: 'moon' });
  });

  it('hides already entered tags, characters, and series from suggestions', async () => {
    const { fixture, element, component, searchService } = await createComponent();

    searchService.addTag('Saber');
    searchService.addCharacter('Rin Tohsaka');
    searchService.addSeries('Fate/stay night');
    fixture.detectChanges();

    await setInputValue(fixture, element, 'sa');
    expect(component.tagSuggestions()).toEqual([]);

    await setInputValue(fixture, element, 'rin');
    expect(component.characterSuggestions()).toEqual([]);

    await setInputValue(fixture, element, 'fate');
    expect(component.seriesSuggestions()).toEqual([]);
  });

  it('opens the advanced filters dialog', async () => {
    const { component, overlay } = await createComponent();

    component.openFilters();

    expect(overlay.textContent).toContain('Search Filters');
  });

  it('shows a collapsed mobile trigger and expands into the full search UI', async () => {
    const { fixture, element, breakpoint } = await createComponent();

    breakpoint.setMatches(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('.search-mobile-trigger')).not.toBeNull();
    expect(element.querySelector('.search-field')).toBeNull();

    (element.querySelector('.search-mobile-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(element.querySelector('.search-field')).not.toBeNull();
    expect(element.querySelector('.search-mobile-close')).not.toBeNull();
  });

  it('shows the active filter count on the mobile trigger', async () => {
    const { fixture, element, breakpoint, searchService } = await createComponent();

    searchService.setAdvancedFilters({ favorited: true, mediaTypes: [MediaType.IMAGE] });
    breakpoint.setMatches(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const trigger = element.querySelector('.search-mobile-trigger') as HTMLElement;
    expect(trigger.textContent).toContain('2 filters active');
    expect(trigger.querySelector('.search-mobile-trigger__badge')?.textContent?.trim()).toBe('2');
  });

  it('keeps entered mobile search state when collapsed and reopened', async () => {
    const { fixture, element, breakpoint, searchService } = await createComponent();

    searchService.addTag('Saber');
    searchService.setText('rin');
    breakpoint.setMatches(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect((element.querySelector('.search-mobile-trigger__label') as HTMLElement).textContent).toContain('Saber');

    (element.querySelector('.search-mobile-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    (element.querySelector('.search-mobile-close') as HTMLButtonElement).click();
    fixture.detectChanges();
    (element.querySelector('.search-mobile-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(searchService.draftChips()).toContainEqual({ type: 'tag', value: 'Saber' });
    expect(searchService.draftText()).toBe('rin');
    expect(element.querySelectorAll('.search-chip')).toHaveLength(1);
  });

  it('keeps the input usable when chips are present', async () => {
    const { fixture, element, searchService } = await createComponent();

    searchService.addTag('Saber');
    searchService.addTag('Archer');
    fixture.detectChanges();

    const tokenRow = element.querySelector('.search-token-row') as HTMLElement;
    const input = element.querySelector('input') as HTMLInputElement;

    expect(tokenRow.querySelectorAll('.search-chip')).toHaveLength(2);
    expect(input).not.toBeNull();
    expect(input.placeholder.length).toBeGreaterThan(0);
  });
});
