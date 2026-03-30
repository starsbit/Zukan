import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { NavbarSearchService } from '../../../../services/navbar-search.service';
import { TagsClientService } from '../../../../services/web/tags-client.service';
import { MediaClientService } from '../../../../services/web/media-client.service';
import { AuthStore } from '../../../../services/web/auth.store';
import { NavbarSearchComponent } from './navbar-search.component';

describe('NavbarSearchComponent', () => {
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

  async function createComponent() {
    await TestBed.configureTestingModule({
      imports: [NavbarSearchComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        {
          provide: TagsClientService,
          useValue: {
            list: (params: { q?: string }) => of({
              items: params.q ? [{ id: 1, name: 'Saber', media_count: 10, category: 4, category_name: 'character', category_key: 'character' }] : [],
              total: 1,
              next_cursor: null,
              has_more: false,
              page_size: 6,
            }),
          },
        },
        {
          provide: MediaClientService,
          useValue: {
            getCharacterSuggestions: (query: string) => of(
              query ? [{ name: 'Rin Tohsaka', media_count: 4 }] : [],
            ),
          },
        },
        NavbarSearchService,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NavbarSearchComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return {
      fixture,
      component: fixture.componentInstance,
      element: fixture.nativeElement as HTMLElement,
      overlay: TestBed.inject(OverlayContainer).getContainerElement(),
      searchService: TestBed.inject(NavbarSearchService),
    };
  }

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
  });

  it('creates and replaces the character chip from suggestions', async () => {
    const { fixture, component, searchService } = await createComponent();

    component.onSuggestionSelected({ option: { value: { type: 'character', value: 'Rin Tohsaka' } } } as never);
    component.onSuggestionSelected({ option: { value: { type: 'character', value: 'Saber Alter' } } } as never);
    fixture.detectChanges();

    expect(searchService.draftChips().filter((chip) => chip.type === 'character')).toEqual([
      { type: 'character', value: 'Saber Alter' },
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
  });

  it('hides already entered tags and characters from suggestions', async () => {
    const { fixture, element, component, searchService } = await createComponent();

    searchService.addTag('Saber');
    searchService.setCharacter('Rin Tohsaka');
    fixture.detectChanges();

    await setInputValue(fixture, element, 'sa');
    expect(component.tagSuggestions()).toEqual([]);

    await setInputValue(fixture, element, 'rin');
    expect(component.characterSuggestions()).toEqual([]);
  });

  it('opens the advanced filters dialog', async () => {
    const { component, overlay } = await createComponent();

    component.openFilters();

    expect(overlay.textContent).toContain('Search Filters');
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
