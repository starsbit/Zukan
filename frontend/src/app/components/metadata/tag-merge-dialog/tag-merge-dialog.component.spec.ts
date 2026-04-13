import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { TagsClientService } from '../../../services/web/tags-client.service';
import { TagMergeDialogComponent } from './tag-merge-dialog.component';

describe('TagMergeDialogComponent', () => {
  it('does not show a stale search error after a target has been selected', async () => {
    const listResponse$ = new Subject<{
      items: Array<{ id: number; name: string; media_count: number; category: number; category_name: string; category_key: string }>;
      total: number;
      next_cursor: null;
      has_more: boolean;
      page_size: number;
    }>();
    const list = vi.fn(() => listResponse$.asObservable());

    await TestBed.configureTestingModule({
      imports: [TagMergeDialogComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            sourceTag: {
              id: 1,
              name: 'solo',
              category: 0,
              category_name: 'general',
              category_key: 'general',
              media_count: 2394,
            },
          },
        },
        {
          provide: MatDialogRef,
          useValue: { close: vi.fn() },
        },
        {
          provide: TagsClientService,
          useValue: { list },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TagMergeDialogComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.targetQuery.setValue('white_sh');
    await new Promise((resolve) => setTimeout(resolve, 220));
    fixture.detectChanges();

    listResponse$.next({
      items: [
        {
          id: 2,
          name: 'white_shirt',
          category: 0,
          category_name: 'general',
          category_key: 'general',
          media_count: 454,
        },
      ],
      total: 1,
      next_cursor: null,
      has_more: false,
      page_size: 8,
    });
    fixture.detectChanges();

    (component as any).onOptionSelected({ option: { value: 2 } } as never);
    fixture.detectChanges();

    listResponse$.error({ error: { detail: 'boom' } });
    fixture.detectChanges();

    expect(component.selectedTag()?.name).toBe('white_shirt');
    expect(component.error()).toBeNull();
  });

  it('shows the same plain-language merge summary structure as other metadata dialogs', async () => {
    const list = vi.fn(() => new Subject().asObservable());

    await TestBed.configureTestingModule({
      imports: [TagMergeDialogComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            sourceTag: {
              id: 1,
              name: 'legacy',
              category: 0,
              category_name: 'general',
              category_key: 'general',
              media_count: 20,
            },
          },
        },
        {
          provide: MatDialogRef,
          useValue: { close: vi.fn() },
        },
        {
          provide: TagsClientService,
          useValue: { list },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TagMergeDialogComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.suggestions.set([
      {
        id: 2,
        name: 'shared',
        category: 0,
        category_name: 'general',
        category_key: 'general',
        media_count: 35,
      },
    ]);
    (component as any).onOptionSelected({ option: { value: 2 } } as never);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    const primaryButton = fixture.debugElement.queryAll(By.css('button')).find((button) =>
      button.nativeElement.textContent.includes('Merge into'),
    );

    expect(text).toContain('Choose the tag you want to keep.');
    expect(text).toContain('Replace this tag');
    expect(text).toContain('Keep this tag');
    expect(text).toContain('What happens next');
    expect(text).toContain('20 media using "Legacy" will use "Shared" instead.');
    expect(text).toContain('"Shared" will stay as the tag you keep.');
    expect(text).toContain('"Legacy" will be removed if nothing still uses this tag.');
    expect(primaryButton?.nativeElement.textContent).toContain('Merge into Shared');
  });
});
