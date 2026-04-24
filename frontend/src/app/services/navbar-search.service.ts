import { computed, Injectable, signal } from '@angular/core';
import { MediaType, MediaVisibility, NsfwFilter, SensitiveFilter, TagFilterMode } from '../models/media';
import { MediaSearchParams } from './web/media-client.service';

export type SearchChipType = 'tag' | 'character' | 'series' | 'ocr';
export type MetadataFilterType = Exclude<SearchChipType, 'ocr'>;
export type SearchQueryParams = Record<string, string | string[] | number | boolean | null>;

export interface SearchParamReader {
  get(name: string): string | null;
  getAll(name: string): string[];
}

export interface SearchChip {
  type: SearchChipType;
  value: string;
}

export interface AppliedSearchState {
  tags: string[];
  characterNames: string[];
  seriesNames: string[];
  ocrText: string | null;
  advanced: AdvancedSearchFilters;
}

export interface AdvancedSearchFilters {
  excludeTags: string[];
  mode: TagFilterMode | null;
  characterMode: TagFilterMode | null;
  seriesMode: TagFilterMode | null;
  nsfw: NsfwFilter | null;
  sensitive: SensitiveFilter | null;
  status: string | null;
  favorited: boolean | null;
  visibility: MediaVisibility | null;
  ownerUsername: string | null;
  uploaderUsername: string | null;
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

const SEARCH_QUERY_PARAM_NAMES = [
  'tag',
  'character_name',
  'series_name',
  'ocr_text',
  'exclude_tag',
  'mode',
  'character_mode',
  'series_mode',
  'nsfw',
  'sensitive',
  'status',
  'favorited',
  'visibility',
  'owner_username',
  'uploader_username',
  'media_type',
  'sort_by',
  'sort_order',
  'captured_year',
  'captured_month',
  'captured_day',
  'captured_after',
  'captured_before',
  'captured_before_year',
  'uploaded_year',
  'uploaded_month',
  'uploaded_day',
  'uploaded_after',
  'uploaded_before',
  'uploaded_before_year',
] as const;

const TAG_FILTER_MODES = new Set<string>(Object.values(TagFilterMode));
const NSFW_FILTERS = new Set<string>(Object.values(NsfwFilter));
const SENSITIVE_FILTERS = new Set<string>(Object.values(SensitiveFilter));
const VISIBILITIES = new Set<string>(Object.values(MediaVisibility));
const MEDIA_TYPES = new Set<string>(Object.values(MediaType));
const SORT_BY_VALUES = new Set<string>(['captured_at', 'uploaded_at', 'filename', 'file_size']);
const SORT_ORDER_VALUES = new Set<string>(['asc', 'desc']);

@Injectable({ providedIn: 'root' })
export class NavbarSearchService {
  readonly searchQueryParamNames = [...SEARCH_QUERY_PARAM_NAMES];

  private readonly emptyAdvancedFilters: AdvancedSearchFilters = {
    excludeTags: [],
    mode: null,
    characterMode: null,
    seriesMode: null,
    nsfw: null,
    sensitive: null,
    status: null,
    favorited: null,
    visibility: null,
    ownerUsername: null,
    uploaderUsername: null,
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
    characterNames: [],
    seriesNames: [],
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
      filters.characterMode != null,
      filters.seriesMode != null,
      filters.nsfw != null,
      filters.sensitive != null,
      filters.status != null,
      filters.favorited != null,
      filters.visibility != null,
      filters.ownerUsername != null,
      filters.uploaderUsername != null,
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
      character_name: applied.characterNames.length > 0 ? applied.characterNames : undefined,
      series_name: applied.seriesNames.length > 0 ? applied.seriesNames : undefined,
      ocr_text: applied.ocrText ?? undefined,
      exclude_tag: applied.advanced.excludeTags.length > 0 ? applied.advanced.excludeTags : undefined,
      mode: applied.advanced.mode ?? undefined,
      character_mode: applied.advanced.characterMode ?? undefined,
      series_mode: applied.advanced.seriesMode ?? undefined,
      nsfw: applied.advanced.nsfw ?? undefined,
      sensitive: applied.advanced.sensitive ?? undefined,
      status: applied.advanced.status ?? undefined,
      favorited: applied.advanced.favorited ?? undefined,
      visibility: applied.advanced.visibility ?? undefined,
      owner_username: applied.advanced.ownerUsername ?? undefined,
      uploader_username: applied.advanced.uploaderUsername ?? undefined,
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

  hydrateFromQueryParams(params: SearchParamReader): void {
    const state = this.stateFromQueryParams(params);

    const chips: SearchChip[] = [
      ...state.tags.map((value) => ({ type: 'tag' as const, value })),
      ...state.characterNames.map((value) => ({ type: 'character' as const, value })),
      ...state.seriesNames.map((value) => ({ type: 'series' as const, value })),
      ...(state.ocrText ? [{ type: 'ocr' as const, value: state.ocrText }] : []),
    ];

    this._draftChips.set(chips);
    this._draftText.set('');
    this._applied.set(state);
  }

  toQueryParams(state: AppliedSearchState = this._applied()): SearchQueryParams {
    const params: SearchQueryParams = {};
    this.setArrayParam(params, 'tag', state.tags);
    this.setArrayParam(params, 'character_name', state.characterNames);
    this.setArrayParam(params, 'series_name', state.seriesNames);
    this.setScalarParam(params, 'ocr_text', state.ocrText);
    this.setArrayParam(params, 'exclude_tag', state.advanced.excludeTags);
    this.setScalarParam(params, 'mode', state.advanced.mode);
    this.setScalarParam(params, 'character_mode', state.advanced.characterMode);
    this.setScalarParam(params, 'series_mode', state.advanced.seriesMode);
    this.setScalarParam(params, 'nsfw', state.advanced.nsfw);
    this.setScalarParam(params, 'sensitive', state.advanced.sensitive);
    this.setScalarParam(params, 'status', state.advanced.status);
    this.setScalarParam(params, 'favorited', state.advanced.favorited);
    this.setScalarParam(params, 'visibility', state.advanced.visibility);
    this.setScalarParam(params, 'owner_username', state.advanced.ownerUsername);
    this.setScalarParam(params, 'uploader_username', state.advanced.uploaderUsername);
    this.setArrayParam(params, 'media_type', state.advanced.mediaTypes);
    this.setScalarParam(params, 'sort_by', state.advanced.sortBy);
    this.setScalarParam(params, 'sort_order', state.advanced.sortOrder);
    this.setScalarParam(params, 'captured_year', state.advanced.capturedYear);
    this.setScalarParam(params, 'captured_month', state.advanced.capturedMonth);
    this.setScalarParam(params, 'captured_day', state.advanced.capturedDay);
    this.setScalarParam(params, 'captured_after', state.advanced.capturedAfter);
    this.setScalarParam(params, 'captured_before', state.advanced.capturedBefore);
    this.setScalarParam(params, 'captured_before_year', state.advanced.capturedBeforeYear);
    this.setScalarParam(params, 'uploaded_year', state.advanced.uploadedYear);
    this.setScalarParam(params, 'uploaded_month', state.advanced.uploadedMonth);
    this.setScalarParam(params, 'uploaded_day', state.advanced.uploadedDay);
    this.setScalarParam(params, 'uploaded_after', state.advanced.uploadedAfter);
    this.setScalarParam(params, 'uploaded_before', state.advanced.uploadedBefore);
    this.setScalarParam(params, 'uploaded_before_year', state.advanced.uploadedBeforeYear);
    return params;
  }

  toQueryParamsWithClears(state: AppliedSearchState = this._applied()): SearchQueryParams {
    const params = this.toQueryParams(state);
    for (const name of SEARCH_QUERY_PARAM_NAMES) {
      if (!(name in params)) {
        params[name] = null;
      }
    }
    return params;
  }

  queryParamsMatch(params: SearchParamReader, state: AppliedSearchState = this._applied()): boolean {
    const current = this.toQueryParams(this.stateFromQueryParams(params));
    const next = this.toQueryParams(state);
    return this.queryParamKey(current) === this.queryParamKey(next);
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

  addCharacter(value: string): void {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    const lowerValue = normalized.toLowerCase();
    this.updateDraftChips((chips) =>
      chips.some((chip) => chip.type === 'character' && chip.value.toLowerCase() === lowerValue)
        ? chips
        : [...chips, { type: 'character', value: normalized }],
    );
    this._draftText.set('');
  }

  addSeries(value: string): void {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    const lowerValue = normalized.toLowerCase();
    this.updateDraftChips((chips) =>
      chips.some((chip) => chip.type === 'series' && chip.value.toLowerCase() === lowerValue)
        ? chips
        : [...chips, { type: 'series', value: normalized }],
    );
    this._draftText.set('');
  }

  addMetadataFilter(type: MetadataFilterType, value: string): void {
    switch (type) {
      case 'tag':
        this.addTag(value);
        return;
      case 'character':
        this.addCharacter(value);
        return;
      case 'series':
        this.addSeries(value);
        return;
    }
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
      characterNames: chips.filter((chip) => chip.type === 'character').map((chip) => chip.value),
      seriesNames: chips.filter((chip) => chip.type === 'series').map((chip) => chip.value),
      ocrText: chips.find((chip) => chip.type === 'ocr')?.value ?? null,
      advanced: this._applied().advanced,
    });
  }

  clear(): void {
    this._draftChips.set([]);
    this._draftText.set('');
    this._applied.set({
      tags: [],
      characterNames: [],
      seriesNames: [],
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
      characterNames: chips.filter((chip) => chip.type === 'character').map((chip) => chip.value),
      seriesNames: chips.filter((chip) => chip.type === 'series').map((chip) => chip.value),
      ocrText: chips.find((chip) => chip.type === 'ocr')?.value ?? null,
    }));
  }

  private normalizeAdvancedFilters(filters: AdvancedSearchFilters): AdvancedSearchFilters {
    return {
      excludeTags: filters.excludeTags.map((tag) => tag.trim()).filter(Boolean),
      mode: filters.mode,
      characterMode: filters.characterMode,
      seriesMode: filters.seriesMode,
      nsfw: filters.nsfw,
      sensitive: filters.sensitive,
      status: filters.status?.trim() || null,
      favorited: filters.favorited,
      visibility: filters.visibility,
      ownerUsername: filters.ownerUsername?.trim() || null,
      uploaderUsername: filters.uploaderUsername?.trim() || null,
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

  private stateFromQueryParams(params: SearchParamReader): AppliedSearchState {
    const tags = this.uniqueTrimmed(params.getAll('tag'));
    const characterNames = this.uniqueTrimmed(params.getAll('character_name'));
    const seriesNames = this.uniqueTrimmed(params.getAll('series_name'));
    const ocrText = params.get('ocr_text')?.trim() || null;
    return {
      tags,
      characterNames,
      seriesNames,
      ocrText,
      advanced: this.normalizeAdvancedFilters({
        excludeTags: this.uniqueTrimmed(params.getAll('exclude_tag')),
        mode: this.parseEnum(params.get('mode'), TAG_FILTER_MODES) as TagFilterMode | null,
        characterMode: this.parseEnum(params.get('character_mode'), TAG_FILTER_MODES) as TagFilterMode | null,
        seriesMode: this.parseEnum(params.get('series_mode'), TAG_FILTER_MODES) as TagFilterMode | null,
        nsfw: this.parseEnum(params.get('nsfw'), NSFW_FILTERS) as NsfwFilter | null,
        sensitive: this.parseEnum(params.get('sensitive'), SENSITIVE_FILTERS) as SensitiveFilter | null,
        status: params.get('status')?.trim() || null,
        favorited: this.parseBoolean(params.get('favorited')),
        visibility: this.parseEnum(params.get('visibility'), VISIBILITIES) as MediaVisibility | null,
        ownerUsername: params.get('owner_username')?.trim() || null,
        uploaderUsername: params.get('uploader_username')?.trim() || null,
        mediaTypes: this.uniqueTrimmed(params.getAll('media_type'))
          .filter((value) => MEDIA_TYPES.has(value)) as MediaType[],
        sortBy: this.parseEnum(params.get('sort_by'), SORT_BY_VALUES) as MediaSearchParams['sort_by'] | null,
        sortOrder: this.parseEnum(params.get('sort_order'), SORT_ORDER_VALUES) as MediaSearchParams['sort_order'] | null,
        capturedYear: this.parseInteger(params.get('captured_year')),
        capturedMonth: this.parseInteger(params.get('captured_month')),
        capturedDay: this.parseInteger(params.get('captured_day')),
        capturedAfter: params.get('captured_after')?.trim() || null,
        capturedBefore: params.get('captured_before')?.trim() || null,
        capturedBeforeYear: this.parseInteger(params.get('captured_before_year')),
        uploadedYear: this.parseInteger(params.get('uploaded_year')),
        uploadedMonth: this.parseInteger(params.get('uploaded_month')),
        uploadedDay: this.parseInteger(params.get('uploaded_day')),
        uploadedAfter: params.get('uploaded_after')?.trim() || null,
        uploadedBefore: params.get('uploaded_before')?.trim() || null,
        uploadedBeforeYear: this.parseInteger(params.get('uploaded_before_year')),
      }),
    };
  }

  private parseEnum(value: string | null, allowed: Set<string>): string | null {
    const normalized = value?.trim() ?? '';
    return allowed.has(normalized) ? normalized : null;
  }

  private parseBoolean(value: string | null): boolean | null {
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return null;
  }

  private parseInteger(value: string | null): number | null {
    const normalized = value?.trim() ?? '';
    if (!/^-?\d+$/.test(normalized)) {
      return null;
    }

    const parsed = Number.parseInt(normalized, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  private uniqueTrimmed(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      const normalized = value.trim();
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(normalized);
    }

    return result;
  }

  private setArrayParam(params: SearchQueryParams, name: string, values: readonly string[]): void {
    const normalized = this.uniqueTrimmed([...values]);
    if (normalized.length > 0) {
      params[name] = normalized;
    }
  }

  private setScalarParam(
    params: SearchQueryParams,
    name: string,
    value: string | number | boolean | null | undefined,
  ): void {
    if (value !== null && value !== undefined && value !== '') {
      params[name] = value;
    }
  }

  private queryParamKey(params: SearchQueryParams): string {
    return Object.keys(params)
      .filter((name) => params[name] !== null)
      .sort()
      .map((name) => {
        const value = params[name];
        const values = Array.isArray(value) ? value : [value];
        return `${name}=${values.map((item) => `${item}`).join('\u0000')}`;
      })
      .join('\u0001');
  }
}
