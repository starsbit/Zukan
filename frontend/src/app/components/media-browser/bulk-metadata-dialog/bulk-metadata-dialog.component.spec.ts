import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { MediaClientService } from '../../../services/web/media-client.service';
import { TagsClientService } from '../../../services/web/tags-client.service';
import { BulkMetadataDialogComponent } from './bulk-metadata-dialog.component';

describe('BulkMetadataDialogComponent', () => {
  async function createComponent() {
    const close = vi.fn();
    const tagsClient = {
      list: vi.fn(() => of({
        items: [{ id: 1, name: 'safe', category: 0, category_name: 'general', category_key: 'general', media_count: 2 }],
        total: 1,
        next_cursor: null,
        has_more: false,
        page_size: 8,
      })),
    };
    const mediaClient = {
      getCharacterSuggestions: vi.fn(() => of([{ name: 'Saber', media_count: 3 }])),
      getSeriesSuggestions: vi.fn(() => of([{ name: 'Fate/stay night', media_count: 4 }])),
    };

    await TestBed.configureTestingModule({
      imports: [BulkMetadataDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { selectedCount: 2 } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: TagsClientService, useValue: tagsClient },
        { provide: MediaClientService, useValue: mediaClient },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(BulkMetadataDialogComponent);
    fixture.detectChanges();
    return { fixture, close, tagsClient, mediaClient };
  }

  it('dedupes chips and closes with the requested add/remove payload', async () => {
    const { fixture, close } = await createComponent();
    const component = fixture.componentInstance;

    component.addChip('add_tags', 'Safe Tag');
    component.addChip('add_tags', 'safe_tag');
    component.addChip('remove_character_names', 'Rin');
    fixture.detectChanges();

    expect(component.chipsFor('add_tags')).toEqual(['Safe Tag']);
    expect(component.canApply()).toBe(true);

    component.apply();

    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      add_tags: ['Safe Tag'],
      remove_character_names: ['Rin'],
    }));
  });

  it('prevents submitting the same normalized value for add and remove', async () => {
    const { fixture, close } = await createComponent();
    const component = fixture.componentInstance;

    component.addChip('add_character_names', 'Saber Alter');
    component.addChip('remove_character_names', 'saber_alter');
    fixture.detectChanges();

    expect(component.hasConflicts()).toBe(true);
    expect(component.canApply()).toBe(false);

    component.apply();
    expect(close).not.toHaveBeenCalled();
  });

  it('loads suggestions for tags, characters, and series', async () => {
    const { fixture, tagsClient, mediaClient } = await createComponent();
    const component = fixture.componentInstance;

    component.controlFor('add_tags').setValue('sa');
    component.controlFor('add_character_names').setValue('Sab');
    component.controlFor('add_series_names').setValue('Fate');
    await new Promise((resolve) => setTimeout(resolve, 220));
    fixture.detectChanges();

    expect(tagsClient.list).toHaveBeenCalledWith({ q: 'sa', page_size: 8 });
    expect(mediaClient.getCharacterSuggestions).toHaveBeenCalledWith('Sab', 8, 'accessible');
    expect(mediaClient.getSeriesSuggestions).toHaveBeenCalledWith('Fate', 8, 'accessible');
    expect(component.suggestionsFor('add_tags')).toEqual(['safe']);
    expect(component.suggestionsFor('add_character_names')).toEqual(['Saber']);
    expect(component.suggestionsFor('add_series_names')).toEqual(['Fate/stay night']);
  });
});
