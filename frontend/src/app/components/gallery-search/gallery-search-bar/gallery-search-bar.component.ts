import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, distinctUntilChanged, forkJoin, of, switchMap } from 'rxjs';

import { CharacterSuggestionsService } from '../../../services/character-suggestions.service';
import { TagsService } from '../../../services/tags.service';
import { formatDisplayValue } from '../../../utils/display-value.utils';
import { GallerySearchSuggestion } from '../gallery-search.models';
import { getAutocompleteContext, normalizeCharacterSearchValue } from '../gallery-search.utils';

@Component({
  selector: 'app-gallery-search-bar',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatBadgeModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule
  ],
  templateUrl: './gallery-search-bar.component.html',
  styleUrl: './gallery-search-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GallerySearchBarComponent implements OnChanges {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly tagsService = inject(TagsService);
  private readonly characterSuggestionsService = inject(CharacterSuggestionsService);

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;
  @Input() searchText = '';
  @Input() activeFilterCount = 0;
  @Output() readonly searchSubmitted = new EventEmitter<string>();
  @Output() readonly filtersRequested = new EventEmitter<void>();
  @Output() readonly cleared = new EventEmitter<void>();

  readonly queryControl = new FormControl<string | GallerySearchSuggestion>('', { nonNullable: true });

  committedSuggestions: GallerySearchSuggestion[] = [];
  tagSuggestions: GallerySearchSuggestion[] = [];
  characterSuggestions: GallerySearchSuggestion[] = [];
  selectedCommittedSuggestionIndex: number | null = null;
  private draftTextValue = '';
  private committedSuggestionTokens = new Set<string>();

  constructor() {
    this.queryControl.valueChanges.pipe(
      takeUntilDestroyed()
    ).subscribe((value) => {
      if (typeof value === 'string') {
        this.draftTextValue = value;
      }
    });

    this.queryControl.valueChanges.pipe(
      debounceTime(200),
      distinctUntilChanged(),
      switchMap((value) => {
        const context = getAutocompleteContext(typeof value === 'string' ? value : this.draftTextValue);
        if (!context) {
          return of({ tags: [], characters: [] });
        }

        if (context.mode === 'tag') {
          return forkJoin({
            tags: this.tagsService.search({ q: context.query, limit: 8 }),
            characters: of([])
          });
        }

        if (context.mode === 'character') {
          return forkJoin({
            tags: of([]),
            characters: this.characterSuggestionsService.search(context.query, 8)
          });
        }

        return forkJoin({
          tags: this.tagsService.search({ q: context.query, limit: 6 }),
          characters: this.characterSuggestionsService.search(context.query, 6)
        });
      }),
      takeUntilDestroyed()
    ).subscribe(({ tags, characters }) => {
      this.tagSuggestions = tags
        .map((tag) => ({
          kind: 'tag' as const,
          label: formatDisplayValue(tag.name),
          token: `tag:${tag.name}`,
          secondary: formatDisplayValue(tag.category_name)
        }))
        .filter((suggestion) => !this.committedSuggestionTokens.has(suggestion.token));
      this.characterSuggestions = characters
        .map((character) => ({
          kind: 'character' as const,
          label: formatDisplayValue(character.name),
          token: `character:${normalizeCharacterSearchValue(character.name)}`,
          secondary: `${character.media_count} match${character.media_count === 1 ? '' : 'es'}`
        }))
        .filter((suggestion) => !this.committedSuggestionTokens.has(suggestion.token));
      this.cdr.markForCheck();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['searchText']) {
      this.syncFromSearchText(this.searchText);
      this.cdr.markForCheck();
    }
  }

  get hasSearchValue(): boolean {
    return this.committedSuggestions.length > 0 || this.draftTextValue.trim().length > 0;
  }

  submit(): void {
    const value = this.queryControl.getRawValue();
    const submittedDraft = this.resolveSubmittedQuery(value).trim();
    const submittedQuery = this.composeSearchText(submittedDraft);

    this.syncFromSearchText(submittedQuery);
    this.cdr.markForCheck();
    this.searchSubmitted.emit(submittedQuery.trim());
    this.refocusInput();
  }

  displaySuggestion(value: string | GallerySearchSuggestion | null): string {
    return typeof value === 'string' ? value : value?.label ?? '';
  }

  selectSuggestion(suggestion: GallerySearchSuggestion): void {
    const nextValue = this.composeSearchText('', [...this.committedSuggestions, suggestion]);
    this.syncFromSearchText(nextValue);
    this.cdr.markForCheck();
    this.searchSubmitted.emit(nextValue.trim());
    this.refocusInput();
  }

  removeCommittedSuggestion(index: number): void {
    this.removeCommittedSuggestionAtIndex(index);
  }

  handleQueryKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (!this.hasSearchValue) {
        return;
      }

      event.preventDefault();
      this.clearAll();
      this.refocusInput();
      return;
    }

    if (event.key !== 'Backspace') {
      if (this.selectedCommittedSuggestionIndex !== null) {
        this.selectedCommittedSuggestionIndex = null;
        this.cdr.markForCheck();
      }
      return;
    }

    if (this.draftTextValue.trim().length > 0 || this.committedSuggestions.length === 0) {
      if (this.selectedCommittedSuggestionIndex !== null) {
        this.selectedCommittedSuggestionIndex = null;
        this.cdr.markForCheck();
      }
      return;
    }

    event.preventDefault();

    if (this.selectedCommittedSuggestionIndex === null) {
      this.selectedCommittedSuggestionIndex = this.committedSuggestions.length - 1;
      this.cdr.markForCheck();
      return;
    }

    this.removeCommittedSuggestionAtIndex(this.selectedCommittedSuggestionIndex);
  }

  selectCommittedSuggestion(index: number): void {
    this.selectedCommittedSuggestionIndex = index;
    this.cdr.markForCheck();
  }

  isCommittedSuggestionSelected(index: number): boolean {
    return this.selectedCommittedSuggestionIndex === index;
  }

  clearAll(): void {
    this.committedSuggestions = [];
    this.selectedCommittedSuggestionIndex = null;
    this.committedSuggestionTokens.clear();
    this.draftTextValue = '';
    this.queryControl.setValue('', { emitEvent: false });
    this.tagSuggestions = [];
    this.characterSuggestions = [];
    this.cdr.markForCheck();
    this.cleared.emit();
  }

  private resolveSubmittedQuery(value: string | GallerySearchSuggestion): string {
    if (typeof value === 'string') {
      return value;
    }

    return value.token;
  }

  private syncFromSearchText(searchText: string): void {
    const { committedSuggestions, draftText } = this.decomposeSearchText(searchText);
    this.committedSuggestions = committedSuggestions;
    this.selectedCommittedSuggestionIndex = null;
    this.committedSuggestionTokens = new Set(committedSuggestions.map((suggestion) => suggestion.token));
    this.draftTextValue = draftText;
    this.queryControl.setValue(draftText, { emitEvent: false });
  }

  private composeSearchText(draftText: string, suggestions = this.committedSuggestions): string {
    const parts = [
      ...suggestions.map((suggestion) => suggestion.token),
      draftText.trim()
    ].filter((part) => part.length > 0);

    return parts.join(' ');
  }

  private decomposeSearchText(searchText: string): { committedSuggestions: GallerySearchSuggestion[]; draftText: string } {
    const committedSuggestions: GallerySearchSuggestion[] = [];
    const draftParts: string[] = [];
    const tokens = searchText.split(/\s+/).map((token) => token.trim()).filter(Boolean);

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index] ?? '';

      if (token.startsWith('tag:')) {
        const value = token.slice('tag:'.length).trim();
        if (value) {
          committedSuggestions.push({
            kind: 'tag',
            label: formatDisplayValue(value),
            token: `tag:${value}`,
            secondary: ''
          });
          continue;
        }
      }

      if (token.startsWith('character:')) {
        const valueParts = [token.slice('character:'.length).trim()];
        while (index + 1 < tokens.length && /^\(.+\)$/.test(tokens[index + 1] ?? '')) {
          index += 1;
          valueParts.push(tokens[index] ?? '');
        }

        const rawValue = valueParts.join(' ').trim();
        if (rawValue) {
          const normalized = normalizeCharacterSearchValue(rawValue);
          committedSuggestions.push({
            kind: 'character',
            label: formatDisplayValue(rawValue),
            token: `character:${normalized}`,
            secondary: ''
          });
          continue;
        }
      }

      draftParts.push(token);
    }

    return {
      committedSuggestions,
      draftText: draftParts.join(' ')
    };
  }

  private extractDraftText(searchText: string): string {
    return this.decomposeSearchText(searchText).draftText;
  }

  private removeCommittedSuggestionAtIndex(index: number): void {
    const nextSuggestions = this.committedSuggestions.filter((_, currentIndex) => currentIndex !== index);
    const nextValue = this.composeSearchText(this.draftTextValue, nextSuggestions);

    this.committedSuggestions = nextSuggestions;
    this.selectedCommittedSuggestionIndex = nextSuggestions.length > 0
      ? Math.min(index, nextSuggestions.length - 1)
      : null;
    this.committedSuggestionTokens = new Set(nextSuggestions.map((suggestion) => suggestion.token));
    this.draftTextValue = this.extractDraftText(nextValue);
    this.queryControl.setValue(this.draftTextValue, { emitEvent: false });
    this.cdr.markForCheck();
    this.searchSubmitted.emit(nextValue.trim());
  }

  private refocusInput(): void {
    queueMicrotask(() => {
      this.searchInput?.nativeElement.focus();
    });
  }
}
