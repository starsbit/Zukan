import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, expect, it, vi } from 'vitest';
import { AlbumShareRole } from '../../../models/albums';
import { AlbumShareDialogComponent } from './album-share-dialog.component';

describe('AlbumShareDialogComponent', () => {
  it('marks the user id field to avoid autofill heuristics', async () => {
    await TestBed.configureTestingModule({
      imports: [AlbumShareDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { albumName: 'Favorites' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumShareDialogComponent);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[formcontrolname="username"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute('autocomplete')).toBe('off');
    expect(input?.getAttribute('name')).toBe('album-share-username');
    expect(input?.getAttribute('data-lpignore')).toBe('true');
    expect(input?.getAttribute('data-bwignore')).toBe('true');
  });

  it('returns the trimmed username and selected role on save', async () => {
    const close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AlbumShareDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { albumName: 'Favorites' } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumShareDialogComponent);
    fixture.detectChanges();

    fixture.componentInstance.form.setValue({
      username: 'shirou',
      role: AlbumShareRole.EDITOR,
    });
    fixture.componentInstance.save();

    expect(close).toHaveBeenCalledWith({
      username: 'shirou',
      role: AlbumShareRole.EDITOR,
    });
  });
});
