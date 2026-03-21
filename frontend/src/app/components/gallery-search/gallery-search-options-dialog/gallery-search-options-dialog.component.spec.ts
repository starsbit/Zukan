import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GallerySearchOptionsDialogComponent } from './gallery-search-options-dialog.component';
import { createDefaultGallerySearchFilters } from '../gallery-search.utils';

describe('GallerySearchOptionsDialogComponent', () => {
  let fixture: ComponentFixture<GallerySearchOptionsDialogComponent>;
  let component: GallerySearchOptionsDialogComponent;
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    dialogRef = {
      close: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [GallerySearchOptionsDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            favorited: 'only',
            nsfw: 'include',
            status: ['done', 'failed'],
            media_type: ['image'],
            captured_after: '2024-01-01T12:00',
            captured_before: '2024-01-05T12:00'
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GallerySearchOptionsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('initializes the form from the injected dialog data', () => {
    expect(component.form.getRawValue()).toEqual({
      favorited: 'only',
      nsfw: 'include',
      status: ['done', 'failed'],
      media_type: ['image'],
      captured_after: '2024-01-01T12:00',
      captured_before: '2024-01-05T12:00'
    });
  });

  it('clears all filters back to the defaults', () => {
    component.clearAll();

    expect(component.form.getRawValue()).toEqual({
      favorited: 'any',
      nsfw: 'default',
      status: ['pending', 'processing', 'done'],
      media_type: [],
      captured_after: '',
      captured_before: ''
    });
  });

  it('applies the current form values and normalizes blank dates to null', () => {
    component.form.setValue({
      favorited: 'only',
      nsfw: 'only',
      status: ['processing'],
      media_type: ['video'],
      captured_after: '',
      captured_before: '2024-02-01T10:00'
    });

    component.apply();

    expect(dialogRef.close).toHaveBeenCalledWith({
      favorited: 'only',
      nsfw: 'only',
      status: ['processing'],
      media_type: ['video'],
      captured_after: null,
      captured_before: '2024-02-01T10:00'
    });
  });

  it('toggles status and media type chip selections', () => {
    component.toggleStatus('failed');
    component.toggleStatus('done');
    component.toggleMediaType('video');
    component.toggleMediaType('image');

    expect(component.form.controls.status.getRawValue()).toEqual([]);
    expect(component.form.controls.media_type.getRawValue()).toEqual(['video']);
  });

  it('renders the expected title and action buttons', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Search options');
    expect(text).toContain('Clear all');
    expect(text).toContain('Search');
    expect(createDefaultGallerySearchFilters().status).toContain('done');
  });
});
