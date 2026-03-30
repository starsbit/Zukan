import { Component, DestroyRef, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { SearchFiltersDialogComponent } from '../search-filters-dialog/search-filters-dialog.component';
import { AuthStore } from '../../../../services/web/auth.store';
import { TagsClientService } from '../../../../services/web/tags-client.service';
import { MediaClientService } from '../../../../services/web/media-client.service';
import { NavbarSearchService, SearchChip } from '../../../../services/navbar-search.service';
import { debounceTime, distinctUntilChanged, forkJoin, of, switchMap } from 'rxjs';

type SuggestionType = 'tag' | 'character';

interface SearchSuggestion {
  type: SuggestionType;
  value: string;
  subtitle: string;
}

@Component({
  selector: 'zukan-navbar-search',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  templateUrl: './navbar-search.component.html',
  styleUrl: './navbar-search.component.scss',
})
export class NavbarSearchComponent {
  private readonly authStore = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly mediaClient = inject(MediaClientService);
  private readonly searchService = inject(NavbarSearchService);
  private readonly tagsClient = inject(TagsClientService);

  readonly autocompleteTrigger = viewChild(MatAutocompleteTrigger);
  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly chips = this.searchService.draftChips;
  readonly disabled = computed(() => !this.authStore.isAuthenticated());
  readonly query = new FormControl(
    { value: this.searchService.draftText(), disabled: this.disabled() },
    { nonNullable: true },
  );
  readonly activeAdvancedFilterCount = this.searchService.activeAdvancedFilterCount;
  readonly tagSuggestions = signal<SearchSuggestion[]>([]);
  readonly characterSuggestions = signal<SearchSuggestion[]>([]);

  constructor() {
    effect(() => {
      const value = this.searchService.draftText();
      if (value !== this.query.value) {
        this.query.setValue(value, { emitEvent: false });
      }

      if (this.disabled()) {
        this.query.disable({ emitEvent: false });
        return;
      }

      this.query.enable({ emitEvent: false });
    });

    this.query.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef),
      debounceTime(150),
      distinctUntilChanged(),
      switchMap((value) => {
        this.searchService.setText(value);
        const query = value.trim();
        if (!this.authStore.isAuthenticated() || !query) {
          return of({ tags: [], characters: [] });
        }

        return forkJoin({
          tags: this.tagsClient.list({ q: query, page_size: 6 }),
          characters: this.mediaClient.getCharacterSuggestions(query, 6),
        });
      }),
    ).subscribe(({ tags, characters }) => {
      const query = this.query.value.trim().toLowerCase();
      const activeTags = new Set(
        this.chips()
          .filter((chip) => chip.type === 'tag')
          .map((chip) => chip.value.toLowerCase()),
      );
      const activeCharacters = new Set(
        this.chips()
          .filter((chip) => chip.type === 'character')
          .map((chip) => chip.value.toLowerCase()),
      );

      this.tagSuggestions.set(
        'items' in tags
          ? tags.items
              .filter((tag) => !activeTags.has(tag.name.toLowerCase()))
              .map((tag) => ({
                type: 'tag' as const,
                value: tag.name,
                subtitle: `${tag.media_count} matches`,
              }))
              .sort((left, right) => this.compareSuggestions(left.value, right.value, query))
          : [],
      );
      this.characterSuggestions.set(
        characters
          .filter((character) => !activeCharacters.has(character.name.toLowerCase()))
          .map((character) => ({
            type: 'character' as const,
            value: character.name,
            subtitle: `${character.media_count} matches`,
          }))
          .sort((left, right) => this.compareSuggestions(left.value, right.value, query)),
      );
    });
  }

  chipLabel(chip: SearchChip): string {
    return chip.type === 'ocr' ? `OCR: "${chip.value}"` : chip.value;
  }

  chipIcon(chip: SearchChip): string {
    switch (chip.type) {
      case 'tag':
        return 'sell';
      case 'character':
        return 'face';
      case 'ocr':
        return 'text_fields';
    }
  }

  hasSuggestions(): boolean {
    return this.tagSuggestions().length + this.characterSuggestions().length > 0;
  }

  hasSearchValue(): boolean {
    return this.chips().length > 0 || this.query.value.trim().length > 0;
  }

  onSuggestionSelected(event: MatAutocompleteSelectedEvent): void {
    const suggestion = event.option.value as SearchSuggestion;
    if (suggestion.type === 'tag') {
      this.searchService.addTag(suggestion.value);
    } else {
      this.searchService.setCharacter(suggestion.value);
    }

    this.resetInput(true);
    this.clearSuggestions();
  }

  onRemoveChip(chip: SearchChip): void {
    this.searchService.removeChip(chip);
  }

  onBackspace(): void {
    if (!this.query.value.trim()) {
      this.searchService.removeLastChip();
    }
  }

  onEnter(event: Event): void {
    const autocompleteTrigger = this.autocompleteTrigger();
    if (autocompleteTrigger?.panelOpen && autocompleteTrigger.activeOption) {
      return;
    }

    event.preventDefault();
    if (!this.authStore.isAuthenticated()) {
      return;
    }

    this.searchService.setText(this.query.value);
    this.searchService.apply();
    this.resetInput(false);
    this.clearSuggestions();
  }

  onEscape(event: Event): void {
    event.preventDefault();
    this.clearAll();
  }

  clearAll(): void {
    this.searchService.clear();
    this.resetInput(false);
    this.clearSuggestions();
    this.autocompleteTrigger()?.closePanel();
  }

  openFilters(): void {
    const dialogRef = this.dialog.open(SearchFiltersDialogComponent, {
      width: 'min(720px, calc(100vw - 32px))',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        filters: this.searchService.advancedFilters(),
      },
    });

    dialogRef.afterClosed().subscribe((filters) => {
      if (!filters) {
        return;
      }

      this.searchService.setAdvancedFilters(filters);
    });
  }

  private clearSuggestions(): void {
    this.tagSuggestions.set([]);
    this.characterSuggestions.set([]);
  }

  private resetInput(emitEvent: boolean): void {
    this.query.reset('', { emitEvent });
    const input = this.searchInput()?.nativeElement;
    if (input) {
      input.value = '';
    }
  }

  private compareSuggestions(left: string, right: string, query: string): number {
    const leftExact = left.toLowerCase().startsWith(query) ? 0 : 1;
    const rightExact = right.toLowerCase().startsWith(query) ? 0 : 1;
    return leftExact - rightExact || left.localeCompare(right);
  }
}
