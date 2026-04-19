import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AlbumShareReadRole } from '../../../models/albums';
import { AlbumStore } from '../../../services/album.store';
import { ConfirmDialogService } from '../../../services/confirm-dialog.service';
import { AlbumAccessDialogComponent } from './album-access-dialog.component';

describe('AlbumAccessDialogComponent', () => {
  it('renders the owner row, accepted entry, and pending entry', async () => {
    const albumStore = {
      listShares: vi.fn(() => of({
        owner: { id: 'owner-1', username: 'owner' },
        entries: [
          {
            user_id: 'viewer-1',
            username: 'viewer_user',
            role: AlbumShareReadRole.VIEWER,
            status: 'accepted' as const,
            shared_at: '2026-04-01T00:00:00Z',
            shared_by_user_id: 'owner-1',
            shared_by_username: 'owner',
          },
          {
            user_id: 'editor-1',
            username: 'editor_user',
            role: AlbumShareReadRole.EDITOR,
            status: 'pending' as const,
            shared_at: '2026-04-02T00:00:00Z',
            shared_by_user_id: 'owner-1',
            shared_by_username: 'owner',
          },
        ],
      })),
      revokeShare: vi.fn(() => of(void 0)),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumAccessDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { albumId: 'album-1', albumName: 'Team album' } },
        { provide: AlbumStore, useValue: albumStore },
        { provide: ConfirmDialogService, useValue: { open: vi.fn(() => of(true)) } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumAccessDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const revokeButtons = Array.from(element.querySelectorAll('button')).filter((button) =>
      button.textContent?.includes('Revoke'),
    );

    expect(element.textContent).toContain('owner');
    expect(element.textContent).toContain('viewer_user');
    expect(element.textContent).toContain('editor_user');
    expect(element.textContent).toContain('Accepted');
    expect(element.textContent).toContain('Pending');
    expect(revokeButtons).toHaveLength(2);
  });

  it('removes the entry and shows feedback after a successful revoke', async () => {
    const snackBar = { open: vi.fn() };
    const confirmDialog = { open: vi.fn(() => of(true)) };
    const albumStore = {
      listShares: vi.fn(() => of({
        owner: { id: 'owner-1', username: 'owner' },
        entries: [
          {
            user_id: 'viewer-1',
            username: 'viewer_user',
            role: AlbumShareReadRole.VIEWER,
            status: 'accepted' as const,
            shared_at: '2026-04-01T00:00:00Z',
            shared_by_user_id: 'owner-1',
            shared_by_username: 'owner',
          },
        ],
      })),
      revokeShare: vi.fn(() => of(void 0)),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumAccessDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { albumId: 'album-1', albumName: 'Team album' } },
        { provide: AlbumStore, useValue: albumStore },
        { provide: ConfirmDialogService, useValue: confirmDialog },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumAccessDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const revokeButton = Array.from(element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Revoke'),
    );

    revokeButton?.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(confirmDialog.open).toHaveBeenCalled();
    expect(albumStore.revokeShare).toHaveBeenCalledWith('album-1', 'viewer-1');
    expect(element.textContent).not.toContain('viewer_user');
    expect(element.textContent).toContain('No one else currently has access.');
    expect(snackBar.open).toHaveBeenCalled();
  });

  it('keeps the entry visible and shows an error when revoke fails', async () => {
    const albumStore = {
      listShares: vi.fn(() => of({
        owner: { id: 'owner-1', username: 'owner' },
        entries: [
          {
            user_id: 'viewer-1',
            username: 'viewer_user',
            role: AlbumShareReadRole.VIEWER,
            status: 'accepted' as const,
            shared_at: '2026-04-01T00:00:00Z',
            shared_by_user_id: 'owner-1',
            shared_by_username: 'owner',
          },
        ],
      })),
      revokeShare: vi.fn(() => throwError(() => ({ error: { detail: 'Nope' } }))),
    };

    await TestBed.configureTestingModule({
      imports: [AlbumAccessDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { albumId: 'album-1', albumName: 'Team album' } },
        { provide: AlbumStore, useValue: albumStore },
        { provide: ConfirmDialogService, useValue: { open: vi.fn(() => of(true)) } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlbumAccessDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const revokeButton = Array.from(element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Revoke'),
    );

    revokeButton?.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.textContent).toContain('viewer_user');
    expect(element.textContent).toContain('Nope');
  });
});
