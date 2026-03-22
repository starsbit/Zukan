import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { createMediaRead } from '../../testing/media-test.utils';
import { CharacterSuggestionsService } from '../../services/character-suggestions.service';
import { TagsService } from '../../services/tags.service';
import { MediaClientService } from '../../services/web/media-client.service';
import { MediaTagEditorComponent } from '../media-tag-editor/media-tag-editor.component';
import { UploadReviewDialogComponent } from './upload-review-dialog.component';

describe('UploadReviewDialogComponent', () => {
  let fixture: ComponentFixture<UploadReviewDialogComponent>;
  let dialogRef: { close: ReturnType<typeof vi.fn> };
  let mediaClient: { getMediaFile: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    dialogRef = {
      close: vi.fn()
    };
    mediaClient = {
      getMediaFile: vi.fn().mockReturnValue(of(new Blob(['image'])))
    };

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:review');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent],
      providers: [
        { provide: CharacterSuggestionsService, useValue: { search: vi.fn().mockReturnValue(of([])) } },
        { provide: TagsService, useValue: { search: vi.fn().mockReturnValue(of([])) } },
        { provide: MAT_DIALOG_DATA, useValue: { media: createMediaRead(), issue: 'missing_character' } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MediaClientService, useValue: mediaClient }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders the missing-character warning and preview', () => {
    expect(fixture.nativeElement.textContent).toContain('no character was found');
    expect(fixture.nativeElement.querySelector('img')).toBeTruthy();
  });

  it('renders the tagging failure warning when tagging failed', async () => {
    fixture.destroy();
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent],
      providers: [
        { provide: CharacterSuggestionsService, useValue: { search: vi.fn().mockReturnValue(of([])) } },
        { provide: TagsService, useValue: { search: vi.fn().mockReturnValue(of([])) } },
        { provide: MAT_DIALOG_DATA, useValue: { media: createMediaRead({ tagging_status: 'failed', tagging_error: 'RuntimeError: boom' }), issue: 'tagging_failed' } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MediaClientService, useValue: mediaClient }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('RuntimeError: boom');
  });

  it('returns edited values when save is clicked', async () => {
    const editor = fixture.debugElement.query(By.directive(MediaTagEditorComponent)).componentInstance as MediaTagEditorComponent;
    editor.characterControl.setValue('ikari_shinji');
    editor.tagInputControl.setValue('hero');
    editor.addTypedTag();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('mat-dialog-actions button:last-child') as HTMLButtonElement).click();

    expect(dialogRef.close).toHaveBeenCalledWith({
      action: 'save',
      characterName: 'ikari_shinji',
      tags: ['fox', 'hero']
    });
  });

  it('supports skip and skip all actions', () => {
    const buttons = fixture.nativeElement.querySelectorAll('mat-dialog-actions button');
    (buttons[0] as HTMLButtonElement).click();
    (buttons[1] as HTMLButtonElement).click();

    expect(dialogRef.close).toHaveBeenNthCalledWith(1, { action: 'skip' });
    expect(dialogRef.close).toHaveBeenNthCalledWith(2, { action: 'skip_all' });
  });

  it('shows a fallback state when the preview cannot be loaded', async () => {
    fixture.destroy();
    mediaClient.getMediaFile.mockReturnValue(throwError(() => new Error('broken')));

    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [UploadReviewDialogComponent],
      providers: [
        { provide: CharacterSuggestionsService, useValue: { search: vi.fn().mockReturnValue(of([])) } },
        { provide: TagsService, useValue: { search: vi.fn().mockReturnValue(of([])) } },
        { provide: MAT_DIALOG_DATA, useValue: { media: createMediaRead(), issue: 'missing_character' } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MediaClientService, useValue: mediaClient }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UploadReviewDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('We could not load this preview.');
  });
});
