import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';

import { CharacterSuggestion, TagRead } from '../../models/api';
import { CharacterSuggestionsService } from '../../services/character-suggestions.service';
import { TagsService } from '../../services/tags.service';
import { formatDisplayValue } from '../../utils/display-value.utils';

export interface MediaTagEditorDraft {
  characterName: string | null;
  tags: string[];
}

@Component({
  selector: 'app-media-tag-editor',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule
  ],
  templateUrl: './media-tag-editor.component.html',
  styleUrl: './media-tag-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MediaTagEditorComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly tagsService = inject(TagsService);
  private readonly characterSuggestionsService = inject(CharacterSuggestionsService);

  @Output() readonly draftChange = new EventEmitter<MediaTagEditorDraft>();

  readonly characterControl = new FormControl('', { nonNullable: true });
  readonly tagInputControl = new FormControl('', { nonNullable: true });

  characterSuggestions: CharacterSuggestion[] = [];
  tagSuggestions: TagRead[] = [];
  selectedTags: string[] = [];

  private currentCharacterName = '';
  private disabledState = false;

  @Input() set characterName(value: string | null | undefined) {
    const nextValue = value?.trim() ?? '';
    this.currentCharacterName = nextValue;
    this.characterControl.setValue(nextValue, { emitEvent: false });
    this.emitDraft();
    this.cdr.markForCheck();
  }

  @Input() set tags(value: string[] | null | undefined) {
    this.selectedTags = [...(value ?? [])];
    this.refreshTagSuggestions(this.tagInputControl.getRawValue());
    this.emitDraft();
    this.cdr.markForCheck();
  }

  @Input() set disabled(value: boolean) {
    this.disabledState = value;
    if (value) {
      this.characterControl.disable({ emitEvent: false });
      this.tagInputControl.disable({ emitEvent: false });
    } else {
      this.characterControl.enable({ emitEvent: false });
      this.tagInputControl.enable({ emitEvent: false });
    }
    this.cdr.markForCheck();
  }

  constructor() {
    this.characterControl.valueChanges.pipe(
      debounceTime(200),
      distinctUntilChanged(),
      switchMap((value) => {
        const query = value.trim();
        if (!query) {
          return of([]);
        }
        return this.characterSuggestionsService.search(query, 6);
      }),
      takeUntilDestroyed()
    ).subscribe((suggestions) => {
      this.characterSuggestions = suggestions;
      this.emitDraft();
      this.cdr.markForCheck();
    });

    this.tagInputControl.valueChanges.pipe(
      debounceTime(150),
      distinctUntilChanged(),
      switchMap((value) => {
        const query = value.trim();
        if (!query) {
          return of([]);
        }
        return this.tagsService.search({ q: query, page_size: 8 });
      }),
      takeUntilDestroyed()
    ).subscribe((results) => {
      this.tagSuggestions = results.filter((tag) => !this.selectedTags.includes(tag.name));
      this.cdr.markForCheck();
    });

    this.characterControl.valueChanges.pipe(
      takeUntilDestroyed()
    ).subscribe((value) => {
      this.currentCharacterName = value;
      this.emitDraft();
    });
  }

  get hasCharacterValue(): boolean {
    return this.characterControl.getRawValue().trim().length > 0;
  }

  get disabled(): boolean {
    return this.disabledState;
  }

  get canAddTypedTag(): boolean {
    return !this.disabledState && this.normalizeTag(this.tagInputControl.getRawValue()) !== null;
  }

  clearCharacter(): void {
    if (this.disabledState) {
      return;
    }

    this.characterControl.setValue('');
    this.characterSuggestions = [];
    this.cdr.markForCheck();
  }

  selectCharacter(suggestion: CharacterSuggestion): void {
    if (this.disabledState) {
      return;
    }

    this.characterControl.setValue(suggestion.name, { emitEvent: false });
    this.currentCharacterName = suggestion.name;
    this.characterSuggestions = [];
    this.emitDraft();
    this.cdr.markForCheck();
  }

  addTypedTagFromEvent(event: Event): void {
    event.preventDefault();
    this.addTypedTag();
  }

  addTypedTag(): void {
    this.commitTag(this.tagInputControl.getRawValue());
  }

  selectTag(tag: TagRead): void {
    this.commitTag(tag.name);
  }

  removeTag(tagToRemove: string): void {
    if (this.disabledState) {
      return;
    }

    this.selectedTags = this.selectedTags.filter((tag) => tag !== tagToRemove);
    this.refreshTagSuggestions(this.tagInputControl.getRawValue());
    this.emitDraft();
    this.cdr.markForCheck();
  }

  formatDisplayValue(value: string | null | undefined): string {
    return formatDisplayValue(value);
  }

  private commitTag(rawValue: string): void {
    if (this.disabledState) {
      return;
    }

    const normalized = this.normalizeTag(rawValue);
    if (!normalized || this.selectedTags.includes(normalized)) {
      this.tagInputControl.setValue('', { emitEvent: false });
      this.tagSuggestions = [];
      this.cdr.markForCheck();
      return;
    }

    this.selectedTags = [...this.selectedTags, normalized];
    this.tagInputControl.setValue('', { emitEvent: false });
    this.tagSuggestions = [];
    this.emitDraft();
    this.cdr.markForCheck();
  }

  private normalizeTag(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? '';
    return normalized ? normalized : null;
  }

  private refreshTagSuggestions(query: string): void {
    if (!query.trim()) {
      this.tagSuggestions = [];
    } else {
      this.tagSuggestions = this.tagSuggestions.filter((tag) => !this.selectedTags.includes(tag.name));
    }
  }

  private emitDraft(): void {
    this.draftChange.emit({
      characterName: this.currentCharacterName.trim() || null,
      tags: [...this.selectedTags]
    });
  }
}
