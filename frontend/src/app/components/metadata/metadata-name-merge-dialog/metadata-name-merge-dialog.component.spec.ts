import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { TagsClientService } from '../../../services/web/tags-client.service';
import { MetadataNameMergeDialogComponent } from './metadata-name-merge-dialog.component';

describe('MetadataNameMergeDialogComponent', () => {
  async function createComponent() {
    const listCharacterNames = vi.fn(() => of({
      items: [
        { name: 'saber', media_count: 4 },
        { name: 'saber_alter', media_count: 8 },
      ],
      total: 2,
      next_cursor: null,
      has_more: false,
      page_size: 8,
    }));

    await TestBed.configureTestingModule({
      imports: [MetadataNameMergeDialogComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            kind: 'characters',
            sourceName: 'rin_tohsaka',
            mediaCount: 3,
          },
        },
        {
          provide: MatDialogRef,
          useValue: { close: vi.fn() },
        },
        {
          provide: TagsClientService,
          useValue: {
            listCharacterNames,
            listSeriesNames: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MetadataNameMergeDialogComponent);
    fixture.detectChanges();
    return { fixture, listCharacterNames };
  }

  it('keeps the selected target after autocomplete writes the chosen value', async () => {
    const { fixture, listCharacterNames } = await createComponent();
    const component = fixture.componentInstance;

    component.targetQuery.setValue('sab');
    await new Promise((resolve) => setTimeout(resolve, 220));
    fixture.detectChanges();

    expect(listCharacterNames).toHaveBeenCalledWith({
      q: 'sab',
      page_size: 8,
      sort_by: 'media_count',
      sort_order: 'desc',
      scope: 'owner',
    });

    component.targetQuery.setValue('saber_alter');
    (component as any).onOptionSelected({ option: { value: 'saber_alter' } } as never);
    fixture.detectChanges();

    expect(component.selectedItem()?.name).toBe('saber_alter');

    await new Promise((resolve) => setTimeout(resolve, 220));
    fixture.detectChanges();

    expect(component.selectedItem()?.name).toBe('saber_alter');
  });

  it('keeps the selected target when the emitted input value is display-formatted text', async () => {
    const { fixture } = await createComponent();
    const component = fixture.componentInstance;

    component.targetQuery.setValue('sab');
    await new Promise((resolve) => setTimeout(resolve, 220));
    fixture.detectChanges();

    (component as any).onOptionSelected({ option: { value: 'saber_alter' } } as never);
    component.targetQuery.setValue('Saber Alter');
    fixture.detectChanges();

    await new Promise((resolve) => setTimeout(resolve, 220));
    fixture.detectChanges();

    expect(component.selectedItem()?.name).toBe('saber_alter');
  });
});
