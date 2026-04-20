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

  it('accumulates character chips and deduplicates them case-insensitively', () => {
    service.addCharacter('Rin');
    service.addCharacter('Saber');
    service.addCharacter('saber');

    expect(service.draftChips().filter((chip) => chip.type === 'character')).toEqual([
      { type: 'character', value: 'Rin' },
      { type: 'character', value: 'Saber' },
    ]);
    expect(service.applied().characterNames).toEqual(['Rin', 'Saber']);
  });

  it('accumulates series chips and deduplicates them case-insensitively', () => {
    service.addSeries('Fate/zero');
    service.addSeries('Fate/stay night');
    service.addSeries('FATE/STAY NIGHT');

    expect(service.draftChips().filter((chip) => chip.type === 'series')).toEqual([
      { type: 'series', value: 'Fate/zero' },
      { type: 'series', value: 'Fate/stay night' },
    ]);
    expect(service.applied().seriesNames).toEqual(['Fate/zero', 'Fate/stay night']);
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
      characterNames: [],
      seriesNames: [],
      ocrText: 'fate stay night',
      advanced: {
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
      },
    });
  });

  it('maps applied chips to media search params', () => {
    service.addTag('Saber');
    service.addCharacter('Rin');
    service.addCharacter('Saber');
    service.addSeries('Fate');
    service.addSeries('Tsukihime');
    service.setOcr('text');
    service.setAdvancedFilters({
      excludeTags: ['spoiler'],
      mode: TagFilterMode.AND,
      characterMode: TagFilterMode.OR,
      seriesMode: TagFilterMode.AND,
      nsfw: NsfwFilter.INCLUDE,
      sensitive: SensitiveFilter.ONLY,
      favorited: true,
      visibility: MediaVisibility.PUBLIC,
      ownerUsername: 'owner_user',
      uploaderUsername: 'uploader_user',
      mediaTypes: [MediaType.IMAGE],
      sortBy: 'captured_at',
      sortOrder: 'desc',
      capturedYear: 2026,
      uploadedYear: 2025,
    });
    service.apply();

    expect(service.appliedParams()).toEqual({
      tag: ['Saber'],
      character_name: ['Rin', 'Saber'],
      series_name: ['Fate', 'Tsukihime'],
      ocr_text: 'text',
      exclude_tag: ['spoiler'],
      mode: TagFilterMode.AND,
      character_mode: TagFilterMode.OR,
      series_mode: TagFilterMode.AND,
      nsfw: NsfwFilter.INCLUDE,
      sensitive: SensitiveFilter.ONLY,
      favorited: true,
      visibility: MediaVisibility.PUBLIC,
      owner_username: 'owner_user',
      uploader_username: 'uploader_user',
      media_type: [MediaType.IMAGE],
      sort_by: 'captured_at',
      sort_order: 'desc',
      captured_year: 2026,
      uploaded_year: 2025,
    });
  });

  it('counts active advanced filters', () => {
    service.setAdvancedFilters({
      excludeTags: ['spoiler'],
      characterMode: TagFilterMode.OR,
      visibility: MediaVisibility.PUBLIC,
      ownerUsername: 'owner_user',
      mediaTypes: [MediaType.VIDEO],
      uploadedBeforeYear: 2027,
    });

    expect(service.activeAdvancedFilterCount()).toBe(6);
  });

  it('normalizes advanced filters and preserves false-y filter values in applied params', () => {
    service.setAdvancedFilters({
      excludeTags: [' spoiler ', ''],
      characterMode: TagFilterMode.OR,
      seriesMode: TagFilterMode.AND,
      status: ' reviewed ',
      favorited: false,
      ownerUsername: ' Owner_User ',
      uploaderUsername: ' Uploader_User ',
      mediaTypes: [MediaType.GIF, MediaType.VIDEO],
      capturedAfter: ' 2026-03-01T00:00 ',
      capturedBefore: ' 2026-03-31T23:59 ',
      capturedBeforeYear: 2027,
      uploadedAfter: ' 2026-04-01T00:00 ',
      uploadedBefore: ' 2026-04-30T23:59 ',
      uploadedBeforeYear: 2028,
    });
    service.apply();

    expect(service.applied().advanced).toMatchObject({
      excludeTags: ['spoiler'],
      characterMode: TagFilterMode.OR,
      seriesMode: TagFilterMode.AND,
      status: 'reviewed',
      favorited: false,
      ownerUsername: 'Owner_User',
      uploaderUsername: 'Uploader_User',
      mediaTypes: [MediaType.GIF, MediaType.VIDEO],
      capturedAfter: '2026-03-01T00:00',
      capturedBefore: '2026-03-31T23:59',
      capturedBeforeYear: 2027,
      uploadedAfter: '2026-04-01T00:00',
      uploadedBefore: '2026-04-30T23:59',
      uploadedBeforeYear: 2028,
    });
    expect(service.appliedParams()).toMatchObject({
      exclude_tag: ['spoiler'],
      character_mode: TagFilterMode.OR,
      series_mode: TagFilterMode.AND,
      status: 'reviewed',
      favorited: false,
      owner_username: 'Owner_User',
      uploader_username: 'Uploader_User',
      media_type: [MediaType.GIF, MediaType.VIDEO],
      captured_after: '2026-03-01T00:00',
      captured_before: '2026-03-31T23:59',
      captured_before_year: 2027,
      uploaded_after: '2026-04-01T00:00',
      uploaded_before: '2026-04-30T23:59',
      uploaded_before_year: 2028,
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
    service.addCharacter('Rin');
    service.addCharacter('Saber');
    service.addSeries('Fate/stay night');
    service.removeChip({ type: 'tag', value: 'Saber' });
    service.removeLastChip();

    expect(service.applied()).toMatchObject({
      tags: [],
      characterNames: ['Rin', 'Saber'],
      seriesNames: [],
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
      characterNames: [],
      seriesNames: [],
      ocrText: null,
      advanced: {
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
      },
    });
  });
});
