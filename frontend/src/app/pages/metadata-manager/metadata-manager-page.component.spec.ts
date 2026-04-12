import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AlbumStore } from '../../services/album.store';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { GalleryStore } from '../../services/gallery.store';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { MediaClientService } from '../../services/web/media-client.service';
import { TagsClientService } from '../../services/web/tags-client.service';
import { AuthStore } from '../../services/web/auth.store';
import { ThemeService } from '../../services/theme.service';
import { MetadataManagerPageComponent } from './metadata-manager-page.component';

describe('MetadataManagerPageComponent', () => {
  async function createComponent(options: {
    list?: ReturnType<typeof vi.fn>;
    listCharacterNames?: ReturnType<typeof vi.fn>;
    listSeriesNames?: ReturnType<typeof vi.fn>;
    removeFromMedia?: ReturnType<typeof vi.fn>;
    removeCharacterFromMedia?: ReturnType<typeof vi.fn>;
    removeSeriesFromMedia?: ReturnType<typeof vi.fn>;
    merge?: ReturnType<typeof vi.fn>;
    mergeCharacterName?: ReturnType<typeof vi.fn>;
    mergeSeriesName?: ReturnType<typeof vi.fn>;
    confirm?: boolean;
    dialogResult?: unknown;
  } = {}) {
    class FakeIntersectionObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    }

    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

    const list = options.list ?? vi.fn(() => of({
      items: [{ id: 1, name: 'saber', category: 0, category_name: 'general', category_key: 'general', media_count: 12 }],
      total: 1,
      next_cursor: null,
      has_more: false,
      page_size: 100,
    }));
    const listCharacterNames = options.listCharacterNames ?? vi.fn(() => of({
      items: [{ name: 'Artoria', media_count: 8 }],
      total: 1,
      next_cursor: null,
      has_more: false,
      page_size: 100,
    }));
    const listSeriesNames = options.listSeriesNames ?? vi.fn(() => of({
      items: [{ name: 'Fate', media_count: 4 }],
      total: 1,
      next_cursor: null,
      has_more: false,
      page_size: 100,
    }));
    const removeFromMedia = options.removeFromMedia ?? vi.fn(() => of({
      matched_media: 12,
      updated_media: 12,
      trashed_media: 0,
      already_trashed: 0,
      deleted_tag: false,
      deleted_source: false,
    }));
    const removeCharacterFromMedia = options.removeCharacterFromMedia ?? vi.fn(() => of({
      matched_media: 8,
      updated_media: 8,
      trashed_media: 0,
      already_trashed: 0,
      deleted_tag: false,
      deleted_source: true,
    }));
    const removeSeriesFromMedia = options.removeSeriesFromMedia ?? vi.fn(() => of({
      matched_media: 4,
      updated_media: 4,
      trashed_media: 0,
      already_trashed: 0,
      deleted_tag: false,
      deleted_source: true,
    }));
    const merge = options.merge ?? vi.fn(() => of({
      matched_media: 12,
      updated_media: 12,
      trashed_media: 0,
      already_trashed: 0,
      deleted_tag: false,
      deleted_source: true,
    }));
    const mergeCharacterName = options.mergeCharacterName ?? vi.fn(() => of({
      matched_media: 8,
      updated_media: 8,
      trashed_media: 0,
      already_trashed: 0,
      deleted_tag: false,
      deleted_source: true,
    }));
    const mergeSeriesName = options.mergeSeriesName ?? vi.fn(() => of({
      matched_media: 4,
      updated_media: 4,
      trashed_media: 0,
      already_trashed: 0,
      deleted_tag: false,
      deleted_source: true,
    }));
    const confirmDialog = { open: vi.fn(() => of(options.confirm ?? true)) };
    const dialog = { open: vi.fn(() => ({ afterClosed: () => of(options.dialogResult ?? null) })) };
    const snackBar = { open: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [MetadataManagerPageComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        {
          provide: AlbumStore,
          useValue: { items: () => [], loading: () => false, loaded: () => true, load: vi.fn(() => of([])), addMedia: vi.fn(() => of({ processed: 0, skipped: 0 })) },
        },
        { provide: GalleryStore, useValue: { clearOptimisticItems: vi.fn() } },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        {
          provide: MediaClientService,
          useValue: {
            search: () => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 100 }),
            getCharacterSuggestions: () => of([]),
            getSeriesSuggestions: () => of([]),
          },
        },
        {
          provide: NavbarSearchService,
          useValue: {
            draftText: () => '',
            draftChips: () => [],
            appliedParams: () => ({}),
            activeAdvancedFilterCount: () => 0,
            setText: vi.fn(),
            addTag: vi.fn(),
            setCharacter: vi.fn(),
            setOcr: vi.fn(),
            setAdvancedFilters: vi.fn(),
            removeChip: vi.fn(),
            removeLastChip: vi.fn(),
            apply: vi.fn(),
            clear: vi.fn(),
          },
        },
        {
          provide: TagsClientService,
          useValue: {
            list,
            listCharacterNames,
            listSeriesNames,
            removeFromMedia,
            removeCharacterFromMedia,
            removeSeriesFromMedia,
            merge,
            mergeCharacterName,
            mergeSeriesName,
          },
        },
        { provide: ConfirmDialogService, useValue: confirmDialog },
        { provide: ThemeService, useValue: { preference: () => 'system', cycle: () => {} } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MetadataManagerPageComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      dialog: MatDialog;
      snackBar: MatSnackBar;
    };
    const dialogOpenSpy = vi.spyOn(component.dialog, 'open').mockReturnValue({
      afterClosed: () => of(options.dialogResult ?? null),
    } as never);
    const snackBarOpenSpy = vi.spyOn(component.snackBar, 'open').mockImplementation(() => undefined as never);

    return {
      fixture,
      list,
      listCharacterNames,
      listSeriesNames,
      removeFromMedia,
      removeCharacterFromMedia,
      removeSeriesFromMedia,
      merge,
      mergeCharacterName,
      mergeSeriesName,
      confirmDialog,
      dialogOpenSpy,
      snackBarOpenSpy,
    };
  }

  it('uses the shared layout and loads tags with owner scope by default', async () => {
    const { fixture, list } = await createComponent();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('zukan-layout')).not.toBeNull();
    expect(element.querySelector('mat-tab-group')).not.toBeNull();
    expect(list).toHaveBeenCalledWith({
      after: undefined,
      page_size: 100,
      q: undefined,
      sort_by: 'media_count',
      sort_order: 'desc',
      scope: 'owner',
    });
    expect(element.textContent).not.toContain('Category');
  });

  it('updates tag list params when filters change', async () => {
    const { fixture, list } = await createComponent();
    list.mockClear();

    const component = fixture.componentInstance;
    component.filters.controls.query.setValue('art');
    component.filters.controls.sort.setValue('name_asc');

    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(list).toHaveBeenCalledWith({
      after: undefined,
      page_size: 100,
      q: 'art',
      sort_by: 'name',
      sort_order: 'asc',
      scope: 'owner',
    });
  });

  it('switches to the character and series tabs with owner-scoped requests', async () => {
    const { fixture, listCharacterNames, listSeriesNames } = await createComponent();

    fixture.componentInstance['onTabChange'](1);
    fixture.detectChanges();
    expect(listCharacterNames).toHaveBeenCalledWith({
      after: undefined,
      page_size: 100,
      q: undefined,
      sort_by: 'media_count',
      sort_order: 'desc',
      scope: 'owner',
    });

    fixture.componentInstance['onTabChange'](2);
    fixture.detectChanges();
    expect(listSeriesNames).toHaveBeenCalledWith({
      after: undefined,
      page_size: 100,
      q: undefined,
      sort_by: 'media_count',
      sort_order: 'desc',
      scope: 'owner',
    });
  });

  it('loads more tags when requested', async () => {
    const list = vi.fn()
      .mockReturnValueOnce(of({
        items: [{ id: 1, name: 'saber', category: 0, category_name: 'general', category_key: 'general', media_count: 12 }],
        total: 2,
        next_cursor: 'c2',
        has_more: true,
        page_size: 100,
      }))
      .mockReturnValueOnce(of({
        items: [{ id: 2, name: 'rin', category: 4, category_name: 'character', category_key: 'character', media_count: 5 }],
        total: 2,
        next_cursor: null,
        has_more: false,
        page_size: 100,
      }));

    const { fixture } = await createComponent({ list });
    fixture.componentInstance['loadMore']();
    fixture.detectChanges();

    expect(list).toHaveBeenLastCalledWith({
      after: 'c2',
      page_size: 100,
      q: undefined,
      sort_by: 'media_count',
      sort_order: 'desc',
      scope: 'owner',
    });
    expect(fixture.componentInstance.tags()).toHaveLength(2);
  });

  it('removes a tag after confirmation and refreshes the list', async () => {
    const { fixture, list, removeFromMedia, confirmDialog, snackBarOpenSpy } = await createComponent();
    list.mockClear();

    fixture.componentInstance['removeTagFromMedia'](
      { id: 1, name: 'saber', category: 0, category_name: 'general', category_key: 'general', media_count: 12 },
    );

    expect(confirmDialog.open).toHaveBeenCalled();
    expect(removeFromMedia).toHaveBeenCalledWith(1);
    expect(list).toHaveBeenCalled();
    expect(snackBarOpenSpy).toHaveBeenCalled();
  });

  it('merges a tag into the selected target and refreshes the list', async () => {
    const { fixture, list, merge, dialogOpenSpy, snackBarOpenSpy } = await createComponent({
      dialogResult: { id: 9, name: 'artoria', category: 0, category_name: 'general', category_key: 'general', media_count: 24 },
    });
    list.mockClear();

    fixture.componentInstance['openTagMergeDialog'](
      { id: 1, name: 'saber', category: 0, category_name: 'general', category_key: 'general', media_count: 12 },
    );

    expect(dialogOpenSpy).toHaveBeenCalled();
    expect(merge).toHaveBeenCalledWith(1, 9);
    expect(list).toHaveBeenCalled();
    expect(snackBarOpenSpy).toHaveBeenCalled();
  });

  it('removes and merges character names on the character tab', async () => {
    const {
      fixture,
      listCharacterNames,
      removeCharacterFromMedia,
      mergeCharacterName,
      dialogOpenSpy,
      snackBarOpenSpy,
    } = await createComponent({
      dialogResult: { name: 'Artoria Pendragon', media_count: 11 },
    });

    fixture.componentInstance['onTabChange'](1);
    fixture.detectChanges();
    listCharacterNames.mockClear();

    fixture.componentInstance['removeNameFromMedia']({ name: 'Saber', media_count: 8 });
    expect(removeCharacterFromMedia).toHaveBeenCalledWith('Saber');
    expect(listCharacterNames).toHaveBeenCalled();

    listCharacterNames.mockClear();
    fixture.componentInstance['openNameMergeDialog']({ name: 'Saber', media_count: 8 });
    expect(dialogOpenSpy).toHaveBeenCalled();
    expect(mergeCharacterName).toHaveBeenCalledWith('Saber', 'Artoria Pendragon');
    expect(listCharacterNames).toHaveBeenCalled();
    expect(snackBarOpenSpy).toHaveBeenCalled();
  });

  it('removes and merges series names on the series tab', async () => {
    const {
      fixture,
      listSeriesNames,
      removeSeriesFromMedia,
      mergeSeriesName,
    } = await createComponent({
      dialogResult: { name: 'Fate stay night', media_count: 6 },
    });

    fixture.componentInstance['onTabChange'](2);
    fixture.detectChanges();
    listSeriesNames.mockClear();

    fixture.componentInstance['removeNameFromMedia']({ name: 'Fate', media_count: 4 });
    expect(removeSeriesFromMedia).toHaveBeenCalledWith('Fate');
    expect(listSeriesNames).toHaveBeenCalled();

    listSeriesNames.mockClear();
    fixture.componentInstance['openNameMergeDialog']({ name: 'Fate', media_count: 4 });
    expect(mergeSeriesName).toHaveBeenCalledWith('Fate', 'Fate stay night');
    expect(listSeriesNames).toHaveBeenCalled();
  });

  it('shows an error message when loading fails', async () => {
    const { fixture } = await createComponent({
      list: vi.fn(() => throwError(() => ({ error: { detail: 'boom' } }))),
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.error()).toBe('boom');
  });
});
