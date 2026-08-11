import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, expect, it, vi } from 'vitest';
import { RenameDialogComponent, RenameDialogData } from './rename-dialog.component';

describe('RenameDialogComponent', () => {
  async function createComponent(data: RenameDialogData, dialogRefOverrides: { close?: ReturnType<typeof vi.fn> } = {}) {
    const close = dialogRefOverrides.close ?? vi.fn();

    await TestBed.configureTestingModule({
      imports: [RenameDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(RenameDialogComponent);
    fixture.detectChanges();

    return { fixture, component: fixture.componentInstance, close };
  }

  it('prefills the form with the initial name', async () => {
    const { component } = await createComponent({
      title: 'Rename tag',
      label: 'Tag name',
      initialName: 'Original Tag',
      maxLength: 255,
    });

    expect(component.form.controls.name.value).toBe('Original Tag');
  });

  it('closes with the trimmed new name on save', async () => {
    const { component, close } = await createComponent({
      title: 'Rename tag',
      label: 'Tag name',
      initialName: 'Original Tag',
      maxLength: 255,
    });

    component.form.controls.name.setValue('  Fixed Tag  ');
    component.save();

    expect(close).toHaveBeenCalledWith('Fixed Tag');
  });

  it('does not close and marks the field touched when the name is empty', async () => {
    const { component, close } = await createComponent({
      title: 'Rename tag',
      label: 'Tag name',
      initialName: 'Original Tag',
      maxLength: 255,
    });

    component.form.controls.name.setValue('');
    component.save();

    expect(close).not.toHaveBeenCalled();
    expect(component.form.controls.name.touched).toBe(true);
    expect(component.form.invalid).toBe(true);
  });

  it('does not close when the name is only whitespace, even though the validator alone would allow it', async () => {
    const { component, close } = await createComponent({
      title: 'Rename tag',
      label: 'Tag name',
      initialName: 'Original Tag',
      maxLength: 255,
    });

    component.form.controls.name.setValue('   ');
    component.save();

    expect(close).not.toHaveBeenCalled();
    expect(component.form.controls.name.touched).toBe(true);
  });

  it('rejects names longer than maxLength', async () => {
    const { component, close } = await createComponent({
      title: 'Rename character',
      label: 'Character name',
      initialName: 'Saber',
      maxLength: 5,
    });

    component.form.controls.name.setValue('Artoria Pendragon');
    component.save();

    expect(close).not.toHaveBeenCalled();
    expect(component.form.controls.name.hasError('maxlength')).toBe(true);
  });
});
