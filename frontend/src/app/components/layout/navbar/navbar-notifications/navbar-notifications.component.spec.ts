import { OverlayContainer } from '@angular/cdk/overlay';
import { of, throwError } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AnnouncementSeverity, NotificationType } from '../../../../models/notifications';
import { AlbumStore } from '../../../../services/album.store';
import { AuthStore } from '../../../../services/web/auth.store';
import { NotificationsClientService } from '../../../../services/web/notifications-client.service';
import { NavbarNotificationsComponent } from './navbar-notifications.component';

describe('NavbarNotificationsComponent', () => {
  const notificationsResponse = {
    total: 2,
    next_cursor: null,
    has_more: false,
    page_size: 8,
    items: [
      {
        id: 'n1',
        user_id: 'u1',
        type: NotificationType.SHARE_INVITE,
        title: 'Album invite',
        body: 'Accept to join as viewer.',
        is_read: false,
        link_url: null,
        data: {
          album_id: 'album-1',
          album_name: 'Spring Trip',
          role: 'viewer',
          invited_by_user_id: 'owner-1',
          invited_by_username: 'owner',
          invite_status: 'pending',
          invite_id: 'invite-1',
        },
        created_at: '2026-03-28T10:00:00Z',
      },
      {
        id: 'n2',
        user_id: 'u1',
        type: NotificationType.APP_UPDATE,
        title: 'Update available',
        body: 'Version 1.2.0 is ready.',
        is_read: false,
        link_url: null,
        data: {
          announcement_id: 'ann-1',
          severity: AnnouncementSeverity.WARNING,
          version: '1.2.0',
          starts_at: null,
          ends_at: null,
        },
        created_at: '2026-03-27T10:00:00Z',
      },
    ],
  };

  it('loads notifications for authenticated users and shows unread count', async () => {
    const list = vi.fn().mockReturnValue(of(notificationsResponse));

    await TestBed.configureTestingModule({
      imports: [NavbarNotificationsComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: NotificationsClientService, useValue: { list } },
        { provide: AlbumStore, useValue: { load: vi.fn().mockReturnValue(of([])) } },
      ],
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarNotificationsComponent);
    fixture.detectChanges();

    expect(list).toHaveBeenCalledWith({ page_size: 8 });
    expect(fixture.componentInstance.unreadCount()).toBe(2);

    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const overlayText = overlayContainer.getContainerElement().textContent ?? '';
    expect(overlayText).toContain('Album invite');
    expect(overlayText).toContain('Update available');
    expect(overlayText).toContain('Accept');
    expect(overlayText).toContain('Reject');
    expect(overlayText).toContain('warning');
    expect(overlayText).toContain('Mark as read');
  });

  it('does not load notifications when not authenticated', async () => {
    const list = vi.fn();

    await TestBed.configureTestingModule({
      imports: [NavbarNotificationsComponent],
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => false } },
        { provide: NotificationsClientService, useValue: { list } },
        { provide: AlbumStore, useValue: { load: vi.fn().mockReturnValue(of([])) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NavbarNotificationsComponent);
    fixture.detectChanges();

    expect(list).not.toHaveBeenCalled();
    expect(fixture.componentInstance.unreadCount()).toBe(0);
  });

  it('shows an error state when loading fails', async () => {
    const list = vi.fn().mockReturnValue(throwError(() => new Error('boom')));

    await TestBed.configureTestingModule({
      imports: [NavbarNotificationsComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: NotificationsClientService, useValue: { list } },
        { provide: AlbumStore, useValue: { load: vi.fn().mockReturnValue(of([])) } },
      ],
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarNotificationsComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(overlayContainer.getContainerElement().textContent).toContain('Unable to load notifications.');
  });

  it('accepts and rejects pending share invites', async () => {
    const list = vi.fn().mockReturnValue(of(notificationsResponse));
    const acceptInvite = vi.fn().mockReturnValue(of({
      ...notificationsResponse.items[0],
      is_read: true,
      data: {
        ...notificationsResponse.items[0].data,
        invite_status: 'accepted',
      },
    }));
    const rejectInvite = vi.fn().mockReturnValue(of({
      ...notificationsResponse.items[0],
      is_read: true,
      data: {
        ...notificationsResponse.items[0].data,
        invite_status: 'rejected',
      },
    }));
    const loadAlbums = vi.fn().mockReturnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [NavbarNotificationsComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: NotificationsClientService, useValue: { list, acceptInvite, rejectInvite } },
        { provide: AlbumStore, useValue: { load: loadAlbums } },
      ],
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarNotificationsComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const buttons = overlayContainer.getContainerElement().querySelectorAll('button');
    (buttons[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(acceptInvite).toHaveBeenCalledWith('n1');
    expect(loadAlbums).toHaveBeenCalled();

    (buttons[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(rejectInvite).toHaveBeenCalledWith('n1');
  });

  it('marks app update notifications as read', async () => {
    const list = vi.fn().mockReturnValue(of(notificationsResponse));
    const markRead = vi.fn().mockReturnValue(of({
      ...notificationsResponse.items[1],
      is_read: true,
    }));

    await TestBed.configureTestingModule({
      imports: [NavbarNotificationsComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthStore, useValue: { isAuthenticated: () => true } },
        { provide: NotificationsClientService, useValue: { list, markRead } },
        { provide: AlbumStore, useValue: { load: vi.fn().mockReturnValue(of([])) } },
      ],
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarNotificationsComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const markReadButton = Array.from(
      overlayContainer.getContainerElement().querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Mark as read')) as HTMLButtonElement;

    markReadButton.click();
    fixture.detectChanges();

    expect(markRead).toHaveBeenCalledWith('n2');
    expect(fixture.componentInstance.notifications().find((item) => item.id === 'n2')?.is_read).toBe(true);
  });
});
