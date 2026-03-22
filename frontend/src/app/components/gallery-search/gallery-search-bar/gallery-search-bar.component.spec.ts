import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GallerySearchBarComponent } from './gallery-search-bar.component';
import { CharacterSuggestionsService } from '../../../services/character-suggestions.service';
import { TagsService } from '../../../services/tags.service';

@Component({
  selector: 'app-gallery-search-bar-host',
  template: `
    <app-gallery-search-bar
      [searchText]="searchText()"
      (searchSubmitted)="applySearch($event)"
      (cleared)="clearSearch()"
    />
  `,
  imports: [GallerySearchBarComponent],
  standalone: true
})
class GallerySearchBarHostComponent {
  readonly searchText = signal('');
  readonly clearedCount = signal(0);

  applySearch(value: string): void {
    this.searchText.set(value);
  }

  clearSearch(): void {
    this.searchText.set('');
    this.clearedCount.update((count) => count + 1);
  }
}

describe('GallerySearchBarComponent', () => {
  let fixture: ComponentFixture<GallerySearchBarComponent>;
  let component: GallerySearchBarComponent;
  let tagsService: { search: ReturnType<typeof vi.fn> };
  let characterSuggestionsService: { search: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    tagsService = {
      search: vi.fn().mockReturnValue(of([]))
    };
    characterSuggestionsService = {
      search: vi.fn().mockReturnValue(of([]))
    };

    await TestBed.configureTestingModule({
      imports: [GallerySearchBarComponent],
      providers: [
        { provide: TagsService, useValue: tagsService },
        { provide: CharacterSuggestionsService, useValue: characterSuggestionsService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GallerySearchBarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('syncs the external search text into the form control', () => {
    fixture.componentRef.setInput('searchText', 'tag:fox');
    fixture.detectChanges();

    expect(component.queryControl.getRawValue()).toBe('');
    expect(component.committedSuggestions).toEqual([{
      kind: 'tag',
      label: 'Fox',
      token: 'tag:fox',
      secondary: ''
    }]);
  });

  it('submits the trimmed raw query string', () => {
    const submittedSpy = vi.fn();
    component.searchSubmitted.subscribe(submittedSpy);
    component.queryControl.setValue('  fox  ');

    component.submit();

    expect(submittedSpy).toHaveBeenCalledWith('fox');
    expect(component.queryControl.getRawValue()).toBe('fox');
    expect(component.committedSuggestions).toEqual([]);
  });

  it('submits the latest typed query even before autocomplete debounce completes', () => {
    vi.useFakeTimers();
    const submittedSpy = vi.fn();
    component.searchSubmitted.subscribe(submittedSpy);

    component.queryControl.setValue('tag:fox');
    component.submit();

    expect(submittedSpy).toHaveBeenCalledWith('tag:fox');
    expect(component.queryControl.getRawValue()).toBe('');
    expect(component.committedSuggestions).toEqual([{
      kind: 'tag',
      label: 'Fox',
      token: 'tag:fox',
      secondary: ''
    }]);
  });

  it('submits the selected autocomplete token when enter is pressed on an active option', () => {
    const submittedSpy = vi.fn();
    component.searchSubmitted.subscribe(submittedSpy);
    component.queryControl.setValue('aya');

    component.queryControl.setValue({
      kind: 'character',
      label: 'Ayanami Rei',
      token: 'character:ayanami_rei',
      secondary: '1 match'
    });
    component.submit();

    expect(submittedSpy).toHaveBeenCalledWith('character:ayanami_rei');
    expect(component.queryControl.getRawValue()).toBe('');
    expect(component.committedSuggestions).toEqual([{
      kind: 'character',
      label: 'Ayanami Rei',
      token: 'character:ayanami_rei',
      secondary: ''
    }]);
  });

  it('displays labels for suggestion objects', () => {
    expect(component.displaySuggestion(null)).toBe('');
    expect(component.displaySuggestion('fox')).toBe('fox');
    expect(component.displaySuggestion({
      kind: 'tag',
      label: 'Forest',
      token: 'tag:forest',
      secondary: 'theme'
    })).toBe('Forest');
  });

  it('replaces the active token and submits the search when a suggestion is selected', () => {
    const submittedSpy = vi.fn();
    component.searchSubmitted.subscribe(submittedSpy);
    component.queryControl.setValue('tag:fo');

    component.selectSuggestion({
      kind: 'tag',
      label: 'fox',
      token: 'tag:fox',
      secondary: 'species'
    });

    expect(component.queryControl.getRawValue()).toBe('');
    expect(component.committedSuggestions).toEqual([{
      kind: 'tag',
      label: 'Fox',
      token: 'tag:fox',
      secondary: ''
    }]);
    expect(submittedSpy).toHaveBeenCalledWith('tag:fox');
  });

  it('clears the search text, committed chips, suggestion lists, and emits a clear event', () => {
    const clearSpy = vi.fn();
    component.cleared.subscribe(clearSpy);
    component.queryControl.setValue('character:fox');
    component.committedSuggestions = [{ kind: 'tag', label: 'fox', token: 'tag:fox', secondary: '' }];
    component.tagSuggestions = [{ kind: 'tag', label: 'fox', token: 'tag:fox', secondary: 'species' }];
    component.characterSuggestions = [{ kind: 'character', label: 'renamon', token: 'character:renamon', secondary: '1 match' }];

    component.clearAll();

    expect(component.queryControl.getRawValue()).toBe('');
    expect(component.committedSuggestions).toEqual([]);
    expect(component.tagSuggestions).toEqual([]);
    expect(component.characterSuggestions).toEqual([]);
    expect(clearSpy).toHaveBeenCalled();
  });

  it('removes a committed chip and re-submits the remaining query', () => {
    const submittedSpy = vi.fn();
    component.searchSubmitted.subscribe(submittedSpy);
    component.committedSuggestions = [
      { kind: 'tag', label: 'fox', token: 'tag:fox', secondary: '' },
      { kind: 'character', label: 'Renamon', token: 'character:renamon', secondary: '' }
    ];

    component.removeCommittedSuggestion(0);

    expect(component.committedSuggestions).toEqual([
      { kind: 'character', label: 'Renamon', token: 'character:renamon', secondary: '' }
    ]);
    expect(submittedSpy).toHaveBeenCalledWith('character:renamon');
  });

  it('emits filtersRequested from the options button', () => {
    const requestedSpy = vi.fn();
    component.filtersRequested.subscribe(requestedSpy);

    (fixture.nativeElement.querySelector('button[aria-label="Search options"]') as HTMLButtonElement).click();

    expect(requestedSpy).toHaveBeenCalled();
  });

  it('requests both tag and character suggestions for plain text queries', async () => {
    vi.useFakeTimers();
    tagsService.search.mockReturnValue(of([{ id: 1, name: 'fox', category: 1, category_name: 'species', media_count: 2 }]));
    characterSuggestionsService.search.mockReturnValue(of([{ name: 'Renamon', media_count: 3 }]));

    component.queryControl.setValue('fox');
    await vi.advanceTimersByTimeAsync(200);
    fixture.detectChanges();

    expect(tagsService.search).toHaveBeenCalledWith({ q: 'fox', page_size: 6 });
    expect(characterSuggestionsService.search).toHaveBeenCalledWith('fox', 6);
    expect(component.tagSuggestions).toEqual([{
      kind: 'tag',
      label: 'Fox',
      token: 'tag:fox',
      secondary: 'Species'
    }]);
    expect(component.characterSuggestions).toEqual([{
      kind: 'character',
      label: 'Renamon',
      token: 'character:renamon',
      secondary: '3 matches'
    }]);
  });

  it('requests only tag suggestions for tag-prefixed queries', async () => {
    vi.useFakeTimers();
    component.queryControl.setValue('tag:fo');
    await vi.advanceTimersByTimeAsync(200);

    expect(tagsService.search).toHaveBeenCalledWith({ q: 'fo', page_size: 8 });
    expect(characterSuggestionsService.search).not.toHaveBeenCalled();
  });

  it('requests only character suggestions for character-prefixed queries', async () => {
    vi.useFakeTimers();
    characterSuggestionsService.search.mockReturnValue(of([{ name: 'Fox', media_count: 1 }]));

    component.queryControl.setValue('character:fo');
    await vi.advanceTimersByTimeAsync(200);

    expect(tagsService.search).not.toHaveBeenCalled();
    expect(characterSuggestionsService.search).toHaveBeenCalledWith('fo', 8);
    expect(component.characterSuggestions[0]?.secondary).toBe('1 match');
  });

  it('filters out committed tag suggestions that are already entered', async () => {
    vi.useFakeTimers();
    fixture.componentRef.setInput('searchText', 'tag:fox');
    tagsService.search.mockReturnValue(of([
      { id: 1, name: 'fox', category: 1, category_name: 'species', media_count: 2 },
      { id: 2, name: 'forest', category: 0, category_name: 'general', media_count: 4 }
    ]));

    component.queryControl.setValue('fo');
    await vi.advanceTimersByTimeAsync(200);
    fixture.detectChanges();

    expect(component.tagSuggestions).toEqual([{
      kind: 'tag',
      label: 'Forest',
      token: 'tag:forest',
      secondary: 'General'
    }]);
  });

  it('filters out committed character suggestions that are already entered', async () => {
    vi.useFakeTimers();
    fixture.componentRef.setInput('searchText', 'character:ayanami_rei');
    characterSuggestionsService.search.mockReturnValue(of([
      { name: 'Ayanami Rei', media_count: 2 },
      { name: 'Asuka Langley', media_count: 1 }
    ]));

    component.queryControl.setValue('a');
    await vi.advanceTimersByTimeAsync(200);
    fixture.detectChanges();

    expect(component.characterSuggestions).toEqual([{
      kind: 'character',
      label: 'Asuka Langley',
      token: 'character:asuka_langley',
      secondary: '1 match'
    }]);
  });

  it('normalizes character suggestion tokens that contain spaces and punctuation', async () => {
    vi.useFakeTimers();
    characterSuggestionsService.search.mockReturnValue(of([{ name: 'Sumika (Muvluv)', media_count: 1 }]));

    component.queryControl.setValue('character:sum');
    await vi.advanceTimersByTimeAsync(200);

    expect(component.characterSuggestions).toEqual([{
      kind: 'character',
      label: 'Sumika (Muvluv)',
      token: 'character:sumika_muvluv',
      secondary: '1 match'
    }]);
  });

  it('formats committed tag and character labels for display while keeping raw tokens', () => {
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes character:ikari_shinji');
    fixture.detectChanges();

    expect(component.committedSuggestions).toEqual([
      {
        kind: 'tag',
        label: 'Blue Eyes',
        token: 'tag:blue_eyes',
        secondary: ''
      },
      {
        kind: 'character',
        label: 'Ikari Shinji',
        token: 'character:ikari_shinji',
        secondary: ''
      }
    ]);
  });

  it('renders committed chips inside the search field', () => {
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes');
    fixture.detectChanges();

    const searchField = fixture.nativeElement.querySelector('mat-form-field.search-field') as HTMLElement;
    const chip = searchField.querySelector('.search-chip') as HTMLElement | null;

    expect(chip).toBeTruthy();
    expect(searchField.textContent).toContain('Blue Eyes');
  });

  it('keeps committed chips as direct inline siblings of the text input in a single horizontal row', () => {
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes tag:white_background');
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector('.search-chip') as HTMLElement;
    const input = fixture.nativeElement.querySelector('input[aria-label="Search gallery"]') as HTMLInputElement;
    const infix = fixture.nativeElement.querySelector('.mat-mdc-form-field-infix') as HTMLElement;
    const chipStyles = getComputedStyle(chip);
    const infixStyles = getComputedStyle(infix);
    const inputStyles = getComputedStyle(input);

    expect(chip.parentElement).toBe(infix);
    expect(input.parentElement).toBe(infix);
    expect(infixStyles.flexWrap).toBe('nowrap');
    expect(infixStyles.overflowX).toBe('auto');
    expect(infixStyles.scrollbarWidth).toBe('none');
    expect(chipStyles.flexBasis).toBe('auto');
    expect(inputStyles.width).toBe('1px');
    expect(inputStyles.flexBasis).toBe('10rem');
  });

  it('renders compact chip sizing inside the search field', () => {
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes');
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector('.search-chip') as HTMLElement;
    const chipKindIcon = fixture.nativeElement.querySelector('.search-chip-kind-icon') as HTMLElement;
    const chipLabel = fixture.nativeElement.querySelector('.search-chip-label') as HTMLElement;
    const chipRemoveIcon = fixture.nativeElement.querySelector('.search-chip-remove-icon') as HTMLElement;
    const chipStyles = getComputedStyle(chip);
    const chipKindStyles = getComputedStyle(chipKindIcon);
    const chipLabelStyles = getComputedStyle(chipLabel);
    const chipIconStyles = getComputedStyle(chipRemoveIcon);

    expect(chipStyles.minHeight).toBe('2rem');
    expect(chipKindStyles.fontSize).toBe('0.58rem');
    expect(chipLabelStyles.fontSize).toBe('0.82rem');
    expect(chipIconStyles.fontSize).toBe('0.8rem');
  });

  it('caps chip width so long tags stay on one row instead of forcing wraps', () => {
    fixture.componentRef.setInput('searchText', 'tag:this_is_a_very_long_tag_name_that_should_not_push_the_input_onto_another_row');
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector('.search-chip') as HTMLElement;
    const chipStyles = getComputedStyle(chip);

    expect(chipStyles.maxWidth).toContain('min(');
    expect(chipStyles.whiteSpace).toBe('nowrap');
  });

  it('shows a tiny kind icon inside each committed chip', () => {
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes character:ikari_shinji');
    fixture.detectChanges();

    const icons = Array.from(
      fixture.nativeElement.querySelectorAll('.search-chip-kind-icon') as NodeListOf<HTMLElement>
    ).map((icon) => icon.textContent?.trim());

    expect(icons).toEqual(['sell', 'person']);
  });

  it('centers the kind icon inside a circular badge', () => {
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes');
    fixture.detectChanges();

    const kindIcon = fixture.nativeElement.querySelector('.search-chip-kind-icon') as HTMLElement;
    const kindIconStyles = getComputedStyle(kindIcon);

    expect(kindIconStyles.display).toBe('inline-grid');
    expect(kindIconStyles.placeItems).toBe('center');
    expect(kindIconStyles.width).toBe('1rem');
    expect(kindIconStyles.height).toBe('1rem');
  });

  it('selects the last committed chip on backspace before removing it on the next backspace', () => {
    const submittedSpy = vi.fn();
    component.searchSubmitted.subscribe(submittedSpy);
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes tag:white_background');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[aria-label="Search gallery"]') as HTMLInputElement;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(component.selectedCommittedSuggestionIndex).toBe(1);
    expect(component.committedSuggestions).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('.search-chip-selected')).toHaveLength(1);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(component.committedSuggestions).toEqual([
      { kind: 'tag', label: 'Blue Eyes', token: 'tag:blue_eyes', secondary: '' }
    ]);
    expect(component.selectedCommittedSuggestionIndex).toBe(0);
    expect(submittedSpy).toHaveBeenLastCalledWith('tag:blue_eyes');
  });

  it('navigates committed chips with the left and right arrow keys from the input', () => {
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes tag:white_background character:ikari_shinji');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[aria-label="Search gallery"]') as HTMLInputElement;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component.selectedCommittedSuggestionIndex).toBe(2);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component.selectedCommittedSuggestionIndex).toBe(1);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component.selectedCommittedSuggestionIndex).toBe(2);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component.selectedCommittedSuggestionIndex).toBeNull();
  });

  it('does not hijack arrow-key cursor movement while the user is typing draft text', () => {
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes');
    fixture.detectChanges();
    component.queryControl.setValue('forest');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[aria-label="Search gallery"]') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(component.selectedCommittedSuggestionIndex).toBeNull();
  });

  it('clears the selected chip state when the user types again', () => {
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[aria-label="Search gallery"]') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(component.selectedCommittedSuggestionIndex).toBe(0);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    fixture.detectChanges();

    expect(component.selectedCommittedSuggestionIndex).toBeNull();
    expect(fixture.nativeElement.querySelector('.search-chip-selected')).toBeNull();
  });

  it('clears the current search when escape is pressed in the input', () => {
    const clearedSpy = vi.fn();
    component.cleared.subscribe(clearedSpy);
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes character:ikari_shinji');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[aria-label="Search gallery"]') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(component.committedSuggestions).toEqual([]);
    expect(component.queryControl.getRawValue()).toBe('');
    expect(clearedSpy).toHaveBeenCalledOnce();
  });

  it('re-focuses the input after submitting a committed search so repeated enter does not clear it', async () => {
    vi.useFakeTimers();
    const submittedSpy = vi.fn();
    const clearedSpy = vi.fn();
    component.searchSubmitted.subscribe(submittedSpy);
    component.cleared.subscribe(clearedSpy);
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes character:ikari_shinji');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[aria-label="Search gallery"]') as HTMLInputElement;
    input.focus();

    component.submit();
    await vi.runAllTimersAsync();
    component.submit();
    await vi.runAllTimersAsync();
    fixture.detectChanges();

    expect(document.activeElement).toBe(input);
    expect(component.committedSuggestions).toEqual([
      { kind: 'tag', label: 'Blue Eyes', token: 'tag:blue_eyes', secondary: '' },
      { kind: 'character', label: 'Ikari Shinji', token: 'character:ikari_shinji', secondary: '' }
    ]);
    expect(clearedSpy).not.toHaveBeenCalled();
    expect(submittedSpy).toHaveBeenNthCalledWith(1, 'tag:blue_eyes character:ikari_shinji');
    expect(submittedSpy).toHaveBeenNthCalledWith(2, 'tag:blue_eyes character:ikari_shinji');
  });

  it('keeps the input focused after the parent re-applies the submitted search text', async () => {
    vi.useFakeTimers();
    const clearedSpy = vi.fn();
    component.cleared.subscribe(clearedSpy);
    component.searchSubmitted.subscribe((searchText) => {
      fixture.componentRef.setInput('searchText', searchText);
    });
    fixture.componentRef.setInput('searchText', 'tag:blue_eyes character:ikari_shinji');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[aria-label="Search gallery"]') as HTMLInputElement;
    input.focus();

    component.submit();
    await vi.runAllTimersAsync();
    fixture.detectChanges();

    expect(document.activeElement).toBe(input);

    component.submit();
    await vi.runAllTimersAsync();
    fixture.detectChanges();

    expect(document.activeElement).toBe(input);
    expect(component.committedSuggestions).toEqual([
      { kind: 'tag', label: 'Blue Eyes', token: 'tag:blue_eyes', secondary: '' },
      { kind: 'character', label: 'Ikari Shinji', token: 'character:ikari_shinji', secondary: '' }
    ]);
    expect(clearedSpy).not.toHaveBeenCalled();
  });

  it('does not clear committed tags when enter is pressed twice through the real input flow', async () => {
    vi.useFakeTimers();
    const hostFixture = TestBed.createComponent(GallerySearchBarHostComponent);
    hostFixture.detectChanges();

    const hostComponent = hostFixture.componentInstance;
    const searchBar = hostFixture.debugElement.children[0].componentInstance as GallerySearchBarComponent;
    const input = hostFixture.nativeElement.querySelector('input[aria-label="Search gallery"]') as HTMLInputElement;

    input.focus();
    input.value = 'tag:blue_eyes';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    hostFixture.detectChanges();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.runAllTimersAsync();
    hostFixture.detectChanges();

    expect(hostComponent.searchText()).toBe('tag:blue_eyes');
    expect(searchBar.committedSuggestions).toEqual([
      { kind: 'tag', label: 'Blue Eyes', token: 'tag:blue_eyes', secondary: '' }
    ]);
    expect(hostComponent.clearedCount()).toBe(0);
    expect(document.activeElement).toBe(input);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.runAllTimersAsync();
    hostFixture.detectChanges();

    expect(hostComponent.searchText()).toBe('tag:blue_eyes');
    expect(searchBar.committedSuggestions).toEqual([
      { kind: 'tag', label: 'Blue Eyes', token: 'tag:blue_eyes', secondary: '' }
    ]);
    expect(hostComponent.clearedCount()).toBe(0);
    expect(document.activeElement).toBe(input);
  });
});
