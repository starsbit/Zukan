import { computed, Injectable, signal } from '@angular/core';
import { MediaType, MediaVisibility, NsfwFilter, SensitiveFilter, TagFilterMode } from '../models/media';
import { MediaSearchParams } from './web/media-client.service';

export type SearchChipType = 'tag' | 'character' | 'series' | 'ocr';

export interface SearchChip {
  type: SearchChipType;
  value: string;
}

export interface AppliedSearchState {
  tags: string[];
  characterName: string | null;
  seriesName: string | null;
  ocrText: string | null;
  advanced: AdvancedSearchFilters;
}

export interface AdvancedSearchFilters {
  excludeTags: string[];
  mode: TagFilterMode | null;
  nsfw: NsfwFilter | null;
  sensitive: SensitiveFilter | null;
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
  uploadedYear: number | null;
  uploadedMonth: number | null;
  uploadedDay: number | null;
  uploadedAfter: string | null;
  uploadedBefore: string | null;
  uploadedBeforeYear: number | null;
}

@Injectable({ providedIn: 'root' })
export class NavbarSearchService {
  private readonly emptyAdvancedFilters: AdvancedSearchFilters = {
    excludeTags: [],
    mode: null,
    nsfw: null,
    sensitive: null,
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
    uploadedYear: null,
    uploadedMonth: null,
    uploadedDay: null,
    uploadedAfter: null,
    uploadedBefore: null,
    uploadedBeforeYear: null,
  };
  private readonly _draftChips = signal<SearchChip[]>([]);
  private readonly _draftText = signal('');
  private readonly _applied = signal<AppliedSearchState>({
    tags: [],
    characterName: null,
    seriesName: null,
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
      filters.sensitive != null,
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
      filters.uploadedYear != null,
      filters.uploadedMonth != null,
      filters.uploadedDay != null,
      filters.uploadedAfter != null,
      filters.uploadedBefore != null,
      filters.uploadedBeforeYear != null,
    ].filter(Boolean).length;
  });
  readonly appliedParams = computed<MediaSearchParams>(() => {
    const applied = this._applied();
    return {
      tag: applied.tags.length > 0 ? applied.tags : undefined,
      character_name: applied.characterName ?? undefined,
      series_name: applied.seriesName ?? undefined,
      ocr_text: applied.ocrText ?? undefined,
      exclude_tag: applied.advanced.excludeTags.length > 0 ? applied.advanced.excludeTags : undefined,
      mode: applied.advanced.mode ?? undefined,
      nsfw: applied.advanced.nsfw ?? undefined,
      sensitive: applied.advanced.sensitive ?? undefined,
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
      uploaded_year: applied.advanced.uploadedYear ?? undefined,
      uploaded_month: applied.advanced.uploadedMonth ?? undefined,
      uploaded_day: applied.advanced.uploadedDay ?? undefined,
      uploaded_after: applied.advanced.uploadedAfter ?? undefined,
      uploaded_before: applied.advanced.uploadedBefore ?? undefined,
      uploaded_before_year: applied.advanced.uploadedBeforeYear ?? undefined,
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
    this.updateDraftChips((chips) =>
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

    this.updateDraftChips((chips) => [
      ...chips.filter((chip) => chip.type !== 'character'),
      { type: 'character', value: normalized },
    ]);
    this._draftText.set('');
  }

  setSeries(value: string): void {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    this.updateDraftChips((chips) => [
      ...chips.filter((chip) => chip.type !== 'series'),
      { type: 'series', value: normalized },
    ]);
    this._draftText.set('');
  }

  setOcr(value: string): void {
    const normalized = value.trim();
    this.updateDraftChips((chips) => {
      const withoutOcr = chips.filter((chip) => chip.type !== 'ocr');
      return normalized ? [...withoutOcr, { type: 'ocr', value: normalized }] : withoutOcr;
    });
    this._draftText.set('');
  }

  removeChip(chip: SearchChip): void {
    this.updateDraftChips((chips) =>
      chips.filter((candidate) => !(candidate.type === chip.type && candidate.value === chip.value)),
    );
  }

  removeLastChip(): void {
    this.updateDraftChips((chips) => chips.slice(0, -1));
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
      seriesName: chips.find((chip) => chip.type === 'series')?.value ?? null,
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
      seriesName: null,
      ocrText: null,
      advanced: this.emptyAdvancedFilters,
    });
  }

  private updateDraftChips(updater: (chips: SearchChip[]) => SearchChip[]): void {
    const current = this._draftChips();
    const next = updater(current);
    if (next === current) {
      return;
    }

    this._draftChips.set(next);
    this.syncAppliedChips();
  }

  private syncAppliedChips(): void {
    const chips = this._draftChips();
    this._applied.update((current) => ({
      ...current,
      tags: chips.filter((chip) => chip.type === 'tag').map((chip) => chip.value),
      characterName: chips.find((chip) => chip.type === 'character')?.value ?? null,
      seriesName: chips.find((chip) => chip.type === 'series')?.value ?? null,
      ocrText: chips.find((chip) => chip.type === 'ocr')?.value ?? null,
    }));
  }

  private normalizeAdvancedFilters(filters: AdvancedSearchFilters): AdvancedSearchFilters {
    return {
      excludeTags: filters.excludeTags.map((tag) => tag.trim()).filter(Boolean),
      mode: filters.mode,
      nsfw: filters.nsfw,
      sensitive: filters.sensitive,
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
      uploadedYear: filters.uploadedYear,
      uploadedMonth: filters.uploadedMonth,
      uploadedDay: filters.uploadedDay,
      uploadedAfter: filters.uploadedAfter?.trim() || null,
      uploadedBefore: filters.uploadedBefore?.trim() || null,
      uploadedBeforeYear: filters.uploadedBeforeYear,
    };
  }
}
