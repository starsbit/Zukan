import { computed, Injectable, signal } from '@angular/core';
import { MediaType, MediaVisibility, NsfwFilter, TagFilterMode } from '../models/media';
import { MediaSearchParams } from './web/media-client.service';

export type SearchChipType = 'tag' | 'character' | 'ocr';

export interface SearchChip {
  type: SearchChipType;
  value: string;
}

export interface AppliedSearchState {
  tags: string[];
  characterName: string | null;
  ocrText: string | null;
  advanced: AdvancedSearchFilters;
}

export interface AdvancedSearchFilters {
  excludeTags: string[];
  mode: TagFilterMode | null;
  nsfw: NsfwFilter | null;
  status: string | null;
  favorited: boolean | null;
  visibility: MediaVisibility | null;
  mediaTypes: MediaType[];
  sortBy: MediaSearchParams['sort_by'] | null;
  sortOrder: MediaSearchParams['sort_order'] | null;
  capturedYear: number | null;
  capturedMonth: number | null;
  capturedDay: number | null;
  capturedAfter: string | null;
  capturedBefore: string | null;
  capturedBeforeYear: number | null;
}

@Injectable({ providedIn: 'root' })
export class NavbarSearchService {
  private readonly emptyAdvancedFilters: AdvancedSearchFilters = {
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
  };
  private readonly _draftChips = signal<SearchChip[]>([]);
  private readonly _draftText = signal('');
  private readonly _applied = signal<AppliedSearchState>({
    tags: [],
    characterName: null,
    ocrText: null,
    advanced: this.emptyAdvancedFilters,
  });

  readonly draftChips = this._draftChips.asReadonly();
  readonly draftText = this._draftText.asReadonly();
  readonly applied = this._applied.asReadonly();
  readonly advancedFilters = computed(() => this._applied().advanced);
  readonly activeAdvancedFilterCount = computed(() => {
    const filters = this._applied().advanced;
    return [
      filters.excludeTags.length > 0,
      filters.mode != null,
      filters.nsfw != null,
      filters.status != null,
      filters.favorited != null,
      filters.visibility != null,
      filters.mediaTypes.length > 0,
      filters.sortBy != null,
      filters.sortOrder != null,
      filters.capturedYear != null,
      filters.capturedMonth != null,
      filters.capturedDay != null,
      filters.capturedAfter != null,
      filters.capturedBefore != null,
      filters.capturedBeforeYear != null,
    ].filter(Boolean).length;
  });
  readonly appliedParams = computed<MediaSearchParams>(() => {
    const applied = this._applied();
    return {
      tag: applied.tags.length > 0 ? applied.tags : undefined,
      character_name: applied.characterName ?? undefined,
      ocr_text: applied.ocrText ?? undefined,
      exclude_tag: applied.advanced.excludeTags.length > 0 ? applied.advanced.excludeTags : undefined,
      mode: applied.advanced.mode ?? undefined,
      nsfw: applied.advanced.nsfw ?? undefined,
      status: applied.advanced.status ?? undefined,
      favorited: applied.advanced.favorited ?? undefined,
      visibility: applied.advanced.visibility ?? undefined,
      media_type: applied.advanced.mediaTypes.length > 0 ? applied.advanced.mediaTypes : undefined,
      sort_by: applied.advanced.sortBy ?? undefined,
      sort_order: applied.advanced.sortOrder ?? undefined,
      captured_year: applied.advanced.capturedYear ?? undefined,
      captured_month: applied.advanced.capturedMonth ?? undefined,
      captured_day: applied.advanced.capturedDay ?? undefined,
      captured_after: applied.advanced.capturedAfter ?? undefined,
      captured_before: applied.advanced.capturedBefore ?? undefined,
      captured_before_year: applied.advanced.capturedBeforeYear ?? undefined,
    };
  });

  setText(value: string): void {
    this._draftText.set(value);
  }

  addTag(value: string): void {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    const lowerValue = normalized.toLowerCase();
    this._draftChips.update((chips) =>
      chips.some((chip) => chip.type === 'tag' && chip.value.toLowerCase() === lowerValue)
        ? chips
        : [...chips, { type: 'tag', value: normalized }],
    );
    this._draftText.set('');
  }

  setCharacter(value: string): void {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    this._draftChips.update((chips) => [
      ...chips.filter((chip) => chip.type !== 'character'),
      { type: 'character', value: normalized },
    ]);
    this._draftText.set('');
  }

  setOcr(value: string): void {
    const normalized = value.trim();
    this._draftChips.update((chips) => {
      const withoutOcr = chips.filter((chip) => chip.type !== 'ocr');
      return normalized ? [...withoutOcr, { type: 'ocr', value: normalized }] : withoutOcr;
    });
    this._draftText.set('');
  }

  removeChip(chip: SearchChip): void {
    this._draftChips.update((chips) =>
      chips.filter((candidate) => !(candidate.type === chip.type && candidate.value === chip.value)),
    );
  }

  removeLastChip(): void {
    this._draftChips.update((chips) => chips.slice(0, -1));
  }

  setAdvancedFilters(filters: Partial<AdvancedSearchFilters>): void {
    this._applied.update((current) => ({
      ...current,
      advanced: this.normalizeAdvancedFilters({
        ...current.advanced,
        ...filters,
      }),
    }));
  }

  apply(): void {
    const pendingText = this._draftText().trim();
    if (pendingText) {
      this.setOcr(pendingText);
    }

    const chips = this._draftChips();
    this._applied.set({
      tags: chips.filter((chip) => chip.type === 'tag').map((chip) => chip.value),
      characterName: chips.find((chip) => chip.type === 'character')?.value ?? null,
      ocrText: chips.find((chip) => chip.type === 'ocr')?.value ?? null,
      advanced: this._applied().advanced,
    });
  }

  clear(): void {
    this._draftChips.set([]);
    this._draftText.set('');
    this._applied.set({
      tags: [],
      characterName: null,
      ocrText: null,
      advanced: this.emptyAdvancedFilters,
    });
  }

  private normalizeAdvancedFilters(filters: AdvancedSearchFilters): AdvancedSearchFilters {
    return {
      excludeTags: filters.excludeTags.map((tag) => tag.trim()).filter(Boolean),
      mode: filters.mode,
      nsfw: filters.nsfw,
      status: filters.status?.trim() || null,
      favorited: filters.favorited,
      visibility: filters.visibility,
      mediaTypes: [...filters.mediaTypes],
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
      capturedYear: filters.capturedYear,
      capturedMonth: filters.capturedMonth,
      capturedDay: filters.capturedDay,
      capturedAfter: filters.capturedAfter?.trim() || null,
      capturedBefore: filters.capturedBefore?.trim() || null,
      capturedBeforeYear: filters.capturedBeforeYear,
    };
  }
}
