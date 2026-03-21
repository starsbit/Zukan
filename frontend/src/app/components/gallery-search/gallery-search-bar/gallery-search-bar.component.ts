import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
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
import { GallerySearchSuggestion } from '../gallery-search.models';
import { getAutocompleteContext, replaceActiveToken } from '../gallery-search.utils';

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

  @Input() searchText = '';
  @Input() activeFilterCount = 0;
  @Output() readonly searchSubmitted = new EventEmitter<string>();
  @Output() readonly filtersRequested = new EventEmitter<void>();
  @Output() readonly cleared = new EventEmitter<void>();

  readonly queryControl = new FormControl<string | GallerySearchSuggestion>('', { nonNullable: true });

  tagSuggestions: GallerySearchSuggestion[] = [];
  characterSuggestions: GallerySearchSuggestion[] = [];
  private lastTextValue = '';

  constructor() {
    this.queryControl.valueChanges.pipe(
      debounceTime(200),
      distinctUntilChanged(),
      switchMap((value) => {
        this.lastTextValue = typeof value === 'string' ? value : this.lastTextValue;
        const context = getAutocompleteContext(typeof value === 'string' ? value : this.lastTextValue);
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
      this.tagSuggestions = tags.map((tag) => ({
        kind: 'tag',
        label: tag.name,
        token: `tag:${tag.name}`,
        secondary: tag.category_name
      }));
      this.characterSuggestions = characters.map((character) => ({
        kind: 'character',
        label: character.name,
        token: `character:${character.name}`,
        secondary: `${character.media_count} match${character.media_count === 1 ? '' : 'es'}`
      }));
      this.cdr.markForCheck();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['searchText'] && this.queryControl.value !== this.searchText) {
      this.lastTextValue = this.searchText;
      this.queryControl.setValue(this.searchText, { emitEvent: false });
      this.cdr.markForCheck();
    }
  }

  submit(): void {
    const value = this.queryControl.getRawValue();
    const submittedQuery = (typeof value === 'string' ? value : this.lastTextValue).trim();

    this.lastTextValue = submittedQuery;
    this.queryControl.setValue(submittedQuery, { emitEvent: false });
    this.cdr.markForCheck();
    this.searchSubmitted.emit(submittedQuery);
  }

  displaySuggestion(value: string | GallerySearchSuggestion | null): string {
    return typeof value === 'string' ? value : value?.label ?? '';
  }

  selectSuggestion(suggestion: GallerySearchSuggestion): void {
    const nextValue = replaceActiveToken(this.lastTextValue, suggestion.token);
    this.lastTextValue = nextValue;
    this.queryControl.setValue(nextValue, { emitEvent: false });
    this.cdr.markForCheck();
  }

  clearAll(): void {
    this.lastTextValue = '';
    this.queryControl.setValue('', { emitEvent: false });
    this.tagSuggestions = [];
    this.characterSuggestions = [];
    this.cdr.markForCheck();
    this.cleared.emit();
  }
}
