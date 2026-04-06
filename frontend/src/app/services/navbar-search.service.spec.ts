import { MediaType, MediaVisibility, NsfwFilter, SensitiveFilter, TagFilterMode } from '../models/media';
import { NavbarSearchService } from './navbar-search.service';

describe('NavbarSearchService', () => {
  let service: NavbarSearchService;

  beforeEach(() => {
    service = new NavbarSearchService();
  });

  it('deduplicates tag chips', () => {
    service.addTag('Saber');
    service.addTag('saber');

    expect(service.draftChips()).toEqual([{ type: 'tag', value: 'Saber' }]);
    expect(service.applied().tags).toEqual(['Saber']);
  });

  it('replaces the character chip', () => {
    service.setCharacter('Rin');
    service.setCharacter('Saber');

    expect(service.draftChips()).toContainEqual({ type: 'character', value: 'Saber' });
    expect(service.draftChips().filter((chip) => chip.type === 'character')).toHaveLength(1);
    expect(service.applied().characterName).toBe('Saber');
  });

  it('replaces the series chip', () => {
    service.setSeries('Fate/zero');
    service.setSeries('Fate/stay night');

    expect(service.draftChips()).toContainEqual({ type: 'series', value: 'Fate/stay night' });
    expect(service.draftChips().filter((chip) => chip.type === 'series')).toHaveLength(1);
    expect(service.applied().seriesName).toBe('Fate/stay night');
  });

  it('replaces the ocr chip', () => {
    service.setOcr('first text');
    service.setOcr('second text');

    expect(service.draftChips()).toContainEqual({ type: 'ocr', value: 'second text' });
    expect(service.draftChips().filter((chip) => chip.type === 'ocr')).toHaveLength(1);
    expect(service.applied().ocrText).toBe('second text');
  });

  it('commits pending text as OCR when applying', () => {
    service.setText('fate stay night');
    service.apply();

    expect(service.applied()).toEqual({
      tags: [],
      characterName: null,
      seriesName: null,
      ocrText: 'fate stay night',
      advanced: {
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
      },
    });
  });

  it('maps applied chips to media search params', () => {
    service.addTag('Saber');
    service.setCharacter('Rin');
    service.setSeries('Fate');
    service.setOcr('text');
    service.setAdvancedFilters({
      excludeTags: ['spoiler'],
      mode: TagFilterMode.AND,
      nsfw: NsfwFilter.INCLUDE,
      sensitive: SensitiveFilter.ONLY,
      favorited: true,
      visibility: MediaVisibility.PUBLIC,
      mediaTypes: [MediaType.IMAGE],
      sortBy: 'captured_at',
      sortOrder: 'desc',
      capturedYear: 2026,
    });
    service.apply();

    expect(service.appliedParams()).toEqual({
      tag: ['Saber'],
      character_name: 'Rin',
      series_name: 'Fate',
      ocr_text: 'text',
      exclude_tag: ['spoiler'],
      mode: TagFilterMode.AND,
      nsfw: NsfwFilter.INCLUDE,
      sensitive: SensitiveFilter.ONLY,
      favorited: true,
      visibility: MediaVisibility.PUBLIC,
      media_type: [MediaType.IMAGE],
      sort_by: 'captured_at',
      sort_order: 'desc',
      captured_year: 2026,
    });
  });

  it('counts active advanced filters', () => {
    service.setAdvancedFilters({
      excludeTags: ['spoiler'],
      visibility: MediaVisibility.PUBLIC,
      mediaTypes: [MediaType.VIDEO],
    });

    expect(service.activeAdvancedFilterCount()).toBe(3);
  });

  it('normalizes advanced filters and preserves false-y filter values in applied params', () => {
    service.setAdvancedFilters({
      excludeTags: [' spoiler ', ''],
      status: ' reviewed ',
      favorited: false,
      mediaTypes: [MediaType.GIF, MediaType.VIDEO],
      capturedAfter: ' 2026-03-01T00:00 ',
      capturedBefore: ' 2026-03-31T23:59 ',
      capturedBeforeYear: 2027,
    });
    service.apply();

    expect(service.applied().advanced).toMatchObject({
      excludeTags: ['spoiler'],
      status: 'reviewed',
      favorited: false,
      mediaTypes: [MediaType.GIF, MediaType.VIDEO],
      capturedAfter: '2026-03-01T00:00',
      capturedBefore: '2026-03-31T23:59',
      capturedBeforeYear: 2027,
    });
    expect(service.appliedParams()).toMatchObject({
      exclude_tag: ['spoiler'],
      status: 'reviewed',
      favorited: false,
      media_type: [MediaType.GIF, MediaType.VIDEO],
      captured_after: '2026-03-01T00:00',
      captured_before: '2026-03-31T23:59',
      captured_before_year: 2027,
    });
  });

  it('keeps applied advanced filters when chip changes sync into the current search', () => {
    service.setAdvancedFilters({
      status: 'done',
      favorited: true,
    });
    service.apply();

    service.addTag('Saber');
    service.setText('draft text');

    expect(service.appliedParams()).toEqual({
      tag: ['Saber'],
      status: 'done',
      favorited: true,
    });
  });

  it('removing chips updates the applied search immediately', () => {
    service.addTag('Saber');
    service.setCharacter('Rin');
    service.setSeries('Fate/stay night');
    service.removeChip({ type: 'tag', value: 'Saber' });
    service.removeLastChip();

    expect(service.applied()).toMatchObject({
      tags: [],
      characterName: 'Rin',
      seriesName: null,
    });
  });

  it('clears draft and applied state', () => {
    service.addTag('Saber');
    service.setText('ocr');
    service.apply();

    service.clear();

    expect(service.draftChips()).toEqual([]);
    expect(service.draftText()).toBe('');
    expect(service.applied()).toEqual({
      tags: [],
      characterName: null,
      seriesName: null,
      ocrText: null,
      advanced: {
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
      },
    });
  });
});
