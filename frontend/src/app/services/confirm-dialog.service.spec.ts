import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialogComponent } from '../components/shared/confirm-dialog/confirm-dialog.component';
import { ConfirmDialogService } from './confirm-dialog.service';

describe('ConfirmDialogService', () => {
  it('opens the shared confirm dialog and maps truthy results', () => {
    const open = vi.fn(() => ({
      afterClosed: () => of(true),
    }));

    TestBed.configureTestingModule({
      providers: [
        ConfirmDialogService,
        { provide: MatDialog, useValue: { open } },
      ],
    });

    const service = TestBed.inject(ConfirmDialogService);
    let result = false;
    service.open({
      title: 'Delete items?',
      message: 'Confirm delete',
      confirmLabel: 'Delete',
      tone: 'warn',
    }).subscribe((value) => {
      result = value;
    });

    expect(open).toHaveBeenCalledWith(ConfirmDialogComponent, {
      data: {
        title: 'Delete items?',
        message: 'Confirm delete',
        confirmLabel: 'Delete',
        tone: 'warn',
      },
    });
    expect(result).toBe(true);
  });
});
