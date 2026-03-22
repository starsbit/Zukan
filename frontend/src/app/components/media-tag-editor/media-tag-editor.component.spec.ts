import '@angular/compiler';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { MediaTagEditorComponent } from './media-tag-editor.component';
import { CharacterSuggestionsService } from '../../services/character-suggestions.service';
import { TagsService } from '../../services/tags.service';

describe('MediaTagEditorComponent', () => {
  let fixture: ComponentFixture<MediaTagEditorComponent>;
  let component: MediaTagEditorComponent;
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
      imports: [MediaTagEditorComponent],
      providers: [
        { provide: TagsService, useValue: tagsService },
        { provide: CharacterSuggestionsService, useValue: characterSuggestionsService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(MediaTagEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats selected tag labels for display', () => {
    fixture.componentRef.setInput('tags', ['blue_eyes']);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Blue Eyes');
    expect(fixture.nativeElement.textContent).not.toContain('blue_eyes');
  });

  it('formats suggestion labels while preserving raw values in the draft', async () => {
    vi.useFakeTimers();
    const draftSpy = vi.fn();
    component.draftChange.subscribe(draftSpy);
    characterSuggestionsService.search.mockReturnValue(of([{ name: 'ikari_shinji', media_count: 2 }]));
    tagsService.search.mockReturnValue(of([{ id: 1, name: 'blue_eyes', category: 1, category_name: 'general_topic', media_count: 5 }]));

    component.characterControl.setValue('ik');
    component.tagInputControl.setValue('bl');
    await vi.advanceTimersByTimeAsync(250);
    fixture.detectChanges();

    expect(component.formatDisplayValue(component.characterSuggestions[0]?.name)).toBe('Ikari Shinji');
    expect(component.formatDisplayValue(component.tagSuggestions[0]?.name)).toBe('Blue Eyes');
    expect(component.formatDisplayValue(component.tagSuggestions[0]?.category_name)).toBe('General Topic');

    component.selectCharacter(component.characterSuggestions[0]!);
    component.selectTag(component.tagSuggestions[0]!);

    expect(draftSpy).toHaveBeenLastCalledWith({
      characterName: 'ikari_shinji',
      tags: ['blue_eyes']
    });
  });
});
