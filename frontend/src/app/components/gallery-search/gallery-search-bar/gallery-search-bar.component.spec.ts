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

    expect(component.queryControl.getRawValue()).toBe('tag:fox');
  });

  it('submits the trimmed raw query string', () => {
    const submittedSpy = vi.fn();
    component.searchSubmitted.subscribe(submittedSpy);
    component.queryControl.setValue('  fox  ');

    component.submit();

    expect(submittedSpy).toHaveBeenCalledWith('fox');
    expect(component.queryControl.getRawValue()).toBe('fox');
  });

  it('submits the latest typed query even before autocomplete debounce completes', () => {
    vi.useFakeTimers();
    const submittedSpy = vi.fn();
    component.searchSubmitted.subscribe(submittedSpy);

    component.queryControl.setValue('tag:fox');
    component.submit();

    expect(submittedSpy).toHaveBeenCalledWith('tag:fox');
    expect(component.queryControl.getRawValue()).toBe('tag:fox');
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
    expect(component.queryControl.getRawValue()).toBe('character:ayanami_rei');
  });

  it('displays labels for suggestion objects', () => {
    expect(component.displaySuggestion(null)).toBe('');
    expect(component.displaySuggestion('fox')).toBe('fox');
    expect(component.displaySuggestion({
      kind: 'tag',
      label: 'forest',
      token: 'tag:forest',
      secondary: 'theme'
    })).toBe('forest');
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

    expect(component.queryControl.getRawValue()).toBe('tag:fox ');
    expect(submittedSpy).toHaveBeenCalledWith('tag:fox');
  });

  it('clears the search text, suggestion lists, and emits a clear event', () => {
    const clearSpy = vi.fn();
    component.cleared.subscribe(clearSpy);
    component.queryControl.setValue('character:fox');
    component.tagSuggestions = [{ kind: 'tag', label: 'fox', token: 'tag:fox', secondary: 'species' }];
    component.characterSuggestions = [{ kind: 'character', label: 'renamon', token: 'character:renamon', secondary: '1 match' }];

    component.clearAll();

    expect(component.queryControl.getRawValue()).toBe('');
    expect(component.tagSuggestions).toEqual([]);
    expect(component.characterSuggestions).toEqual([]);
    expect(clearSpy).toHaveBeenCalled();
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
      label: 'fox',
      token: 'tag:fox',
      secondary: 'species'
    }]);
    expect(component.characterSuggestions).toEqual([{
      kind: 'character',
      label: 'Renamon',
      token: 'character:Renamon',
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
});
