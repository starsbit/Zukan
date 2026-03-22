import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { GallerySearchBarComponent } from './gallery-search-bar.component';
import { CharacterSuggestionsService } from '../../../services/character-suggestions.service';
import { TagsService } from '../../../services/tags.service';
import { GallerySearchSuggestion } from '../gallery-search.models';

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

    expect(tagsService.search).toHaveBeenCalledWith({ q: 'fox', limit: 6 });
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

    expect(tagsService.search).toHaveBeenCalledWith({ q: 'fo', limit: 8 });
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
});
