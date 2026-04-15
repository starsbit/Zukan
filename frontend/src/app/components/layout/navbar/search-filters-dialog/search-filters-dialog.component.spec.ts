import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MediaType, MediaVisibility, NsfwFilter, SensitiveFilter, TagFilterMode, TaggingStatus } from '../../../../models/media';
import { SearchFiltersDialogComponent } from './search-filters-dialog.component';
import { API_BASE_URL } from '../../../../services/web/api.config';

describe('SearchFiltersDialogComponent', () => {
  const filters = {
    excludeTags: ['spoiler'],
    mode: TagFilterMode.AND,
    nsfw: NsfwFilter.INCLUDE,
    sensitive: SensitiveFilter.ONLY,
    status: TaggingStatus.DONE,
    favorited: true,
    visibility: MediaVisibility.PUBLIC,
    mediaTypes: [MediaType.IMAGE],
    sortBy: 'captured_at' as const,
    sortOrder: 'desc' as const,
    capturedYear: 2026,
    capturedMonth: 3,
    capturedDay: 28,
    capturedAfter: '2026-03-01T00:00',
    capturedBefore: '2026-03-31T23:59',
    capturedBeforeYear: 2027,
    uploadedYear: 2026,
    uploadedMonth: 4,
    uploadedDay: 1,
    uploadedAfter: '2026-04-01T00:00',
    uploadedBefore: '2026-04-30T23:59',
    uploadedBeforeYear: 2027,
  };

  async function setup(data = { filters }, close = vi.fn()) {
    await TestBed.configureTestingModule({
      imports: [SearchFiltersDialogComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SearchFiltersDialogComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, close };
  }

  it('initializes the form from existing filters', async () => {
    const { fixture } = await setup();

    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({
      mode: TagFilterMode.AND,
      nsfw: NsfwFilter.INCLUDE,
      sensitive: SensitiveFilter.ONLY,
      status: TaggingStatus.DONE,
      favorited: 'only',
      visibility: MediaVisibility.PUBLIC,
      mediaTypes: [MediaType.IMAGE],
      sortBy: 'captured_at',
      sortOrder: 'desc',
      capturedYear: '2026',
      uploadedYear: '2026',
    });
    expect(fixture.componentInstance.excludeTagChips()).toEqual(['spoiler']);
  });

  it('maps form values back to advanced search filters on apply', async () => {
    const { fixture, component, close } = await setup();

    component.excludeTagChips.set(['spoiler', 'duplicate']);
    fixture.componentInstance.form.patchValue({
      favorited: 'exclude',
      mediaTypes: [MediaType.GIF, MediaType.VIDEO],
      capturedYear: '2025',
      capturedMonth: '',
    });
    fixture.componentInstance.apply();

    expect(close).toHaveBeenCalledWith({
      excludeTags: ['spoiler', 'duplicate'],
      mode: TagFilterMode.AND,
      nsfw: NsfwFilter.INCLUDE,
      sensitive: SensitiveFilter.ONLY,
      status: TaggingStatus.DONE,
      favorited: false,
      visibility: MediaVisibility.PUBLIC,
      mediaTypes: [MediaType.GIF, MediaType.VIDEO],
      sortBy: 'captured_at',
      sortOrder: 'desc',
      capturedYear: 2025,
      capturedMonth: null,
      capturedDay: 28,
      capturedAfter: '2026-03-01T00:00',
      capturedBefore: '2026-03-31T23:59',
      capturedBeforeYear: 2027,
      uploadedYear: 2026,
      uploadedMonth: 4,
      uploadedDay: 1,
      uploadedAfter: '2026-04-01T00:00',
      uploadedBefore: '2026-04-30T23:59',
      uploadedBeforeYear: 2027,
    });
  });

  it('accepts numeric control values for captured date filters on apply', async () => {
    const { fixture, close } = await setup();

    fixture.componentInstance.form.patchValue({
      capturedYear: 2024 as never,
      capturedMonth: 12 as never,
      capturedDay: 31 as never,
      capturedBeforeYear: 2025 as never,
    });

    fixture.componentInstance.apply();

    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      capturedYear: 2024,
      capturedMonth: 12,
      capturedDay: 31,
      capturedBeforeYear: 2025,
      uploadedYear: 2026,
      uploadedMonth: 4,
      uploadedDay: 1,
      uploadedBeforeYear: 2027,
    }));
  });

  it('returns an empty filter set when cleared', async () => {
    const { fixture, close } = await setup();

    fixture.componentInstance.clear();

    expect(close).toHaveBeenCalledWith({
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
    });
  });

  it('trims text fields and maps the favorites any option back to null', async () => {
    const { fixture, component, close } = await setup();

    component.excludeTagChips.set(['spoiler', 'hidden']);
    fixture.componentInstance.form.patchValue({
      favorited: 'any',
      capturedAfter: ' 2026-03-01T00:00 ',
      capturedBefore: ' 2026-03-31T23:59 ',
      mediaTypes: [],
    });
    fixture.componentInstance.apply();

    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      excludeTags: ['spoiler', 'hidden'],
      status: TaggingStatus.DONE,
      favorited: null,
      capturedAfter: '2026-03-01T00:00',
      capturedBefore: '2026-03-31T23:59',
      uploadedAfter: '2026-04-01T00:00',
      uploadedBefore: '2026-04-30T23:59',
      mediaTypes: [],
    }));
  });

  it('addExcludeTag deduplicates by lowercase', async () => {
    const emptyFilters = { ...filters, excludeTags: [] };
    const { component } = await setup({ filters: emptyFilters });

    component.addExcludeTag('tag_one');
    component.addExcludeTag('TAG_ONE');
    component.addExcludeTag('Tag_Two');

    expect(component.excludeTagChips()).toEqual(['tag_one', 'Tag_Two']);
  });

  it('removeExcludeTag removes the specified chip', async () => {
    const emptyFilters = { ...filters, excludeTags: [] };
    const { component } = await setup({ filters: emptyFilters });

    component.addExcludeTag('tag_a');
    component.addExcludeTag('tag_b');
    component.removeExcludeTag('tag_a');

    expect(component.excludeTagChips()).toEqual(['tag_b']);
  });

  it('clear() resets exclude tag chips to empty', async () => {
    const { component } = await setup();

    component.addExcludeTag('tag_a');
    component.clear();

    expect(component.excludeTagChips()).toEqual([]);
  });

  it('statusOptions contains all TaggingStatus values plus null', async () => {
    const { component } = await setup();

    const values = component.statusOptions.map((o) => o.value);
    expect(values).toContain(null);
    expect(values).toContain(TaggingStatus.PENDING);
    expect(values).toContain(TaggingStatus.PROCESSING);
    expect(values).toContain(TaggingStatus.DONE);
    expect(values).toContain(TaggingStatus.FAILED);
  });
});
