import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MediaType, MediaVisibility, NsfwFilter, TagFilterMode } from '../../../../models/media';
import { SearchFiltersDialogComponent } from './search-filters-dialog.component';

describe('SearchFiltersDialogComponent', () => {
  const filters = {
    excludeTags: ['spoiler'],
    mode: TagFilterMode.AND,
    nsfw: NsfwFilter.INCLUDE,
    status: 'done',
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
  };

  it('initializes the form from existing filters', async () => {
    await TestBed.configureTestingModule({
      imports: [SearchFiltersDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { filters } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SearchFiltersDialogComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({
      excludeTags: 'spoiler',
      mode: TagFilterMode.AND,
      nsfw: NsfwFilter.INCLUDE,
      status: 'done',
      favorited: 'only',
      visibility: MediaVisibility.PUBLIC,
      mediaTypes: [MediaType.IMAGE],
      sortBy: 'captured_at',
      sortOrder: 'desc',
      capturedYear: '2026',
    });
  });

  it('maps form values back to advanced search filters on apply', async () => {
    const close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SearchFiltersDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { filters } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SearchFiltersDialogComponent);
    fixture.detectChanges();

    fixture.componentInstance.form.patchValue({
      excludeTags: 'spoiler, duplicate',
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
      status: 'done',
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
    });
  });

  it('accepts numeric control values for captured date filters on apply', async () => {
    const close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SearchFiltersDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { filters } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SearchFiltersDialogComponent);
    fixture.detectChanges();

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
    }));
  });

  it('returns an empty filter set when cleared', async () => {
    const close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SearchFiltersDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { filters } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SearchFiltersDialogComponent);
    fixture.detectChanges();

    fixture.componentInstance.clear();

    expect(close).toHaveBeenCalledWith({
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
    });
  });

  it('trims text fields and maps the favorites any option back to null', async () => {
    const close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SearchFiltersDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { filters } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SearchFiltersDialogComponent);
    fixture.detectChanges();

    fixture.componentInstance.form.patchValue({
      excludeTags: ' spoiler ,  hidden ',
      status: ' reviewed ',
      favorited: 'any',
      capturedAfter: ' 2026-03-01T00:00 ',
      capturedBefore: ' 2026-03-31T23:59 ',
      mediaTypes: [],
    });
    fixture.componentInstance.apply();

    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      excludeTags: ['spoiler', 'hidden'],
      status: 'reviewed',
      favorited: null,
      capturedAfter: '2026-03-01T00:00',
      capturedBefore: '2026-03-31T23:59',
      mediaTypes: [],
    }));
  });
});
