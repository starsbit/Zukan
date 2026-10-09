import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, it, expect, vi } from 'vitest';
import { StorageSetupDialogComponent } from './storage-setup-dialog.component';
import { API_BASE_URL } from '../../services/web/api.config';

describe('StorageSetupDialogComponent', () => {
  it('persists confirmation before closing and allows recovery from unavailable storage', () => {
    const close = vi.fn();
    TestBed.configureTestingModule({imports: [StorageSetupDialogComponent], providers: [provideHttpClient(), provideHttpClientTesting(),
      {provide: API_BASE_URL, useValue: ''}, {provide: MAT_DIALOG_DATA, useValue: {root: '/library'}},
      {provide: MatDialogRef, useValue: {close, disableClose: false}},
    ]});
    const fixture = TestBed.createComponent(StorageSetupDialogComponent);
    const c = fixture.componentInstance; const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('/library');
    c.keepCurrentFolder(); const failed = http.expectOne('/api/v1/admin/storage/confirm');
    expect(failed.request.body).toEqual({root: '/library'});
    failed.flush({detail: 'Library storage is unavailable'}, {status: 409, statusText: 'Conflict'});
    expect(close).not.toHaveBeenCalled(); expect(c.error()).toContain('unavailable'); expect(c.saving()).toBe(false);
    c.keepCurrentFolder(); http.expectOne('/api/v1/admin/storage/confirm').flush({folder_configured: true});
    expect(close).toHaveBeenCalledWith('confirmed'); http.verify(); fixture.destroy();
  });
});
