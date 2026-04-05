import { OverlayContainer } from '@angular/cdk/overlay';
import { of, throwError } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AnnouncementSeverity, NotificationType } from '../../../../models/notifications';
import { AlbumStore } from '../../../../services/album.store';
import { ReviewReminderService } from '../../../../services/review-reminder.service';
import { AuthStore } from '../../../../services/web/auth.store';
import { NotificationsClientService } from '../../../../services/web/notifications-client.service';
import { UsersClientService } from '../../../../services/web/users-client.service';
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
  const reviewReminder = {
    id: 'review-reminder:3:b1',
    user_id: 'u1',
    type: NotificationType.METADATA_REVIEW,
    title: 'Some uploaded media still need names',
    body: '3 uploaded files still need character or series names.',
    is_read: false,
    link_url: null,
    data: {
      latest_batch_id: 'b1',
      review_batch_ids: ['b1'],
      unresolved_count: 3,
      dismiss_signature: '3:b1',
    },
    created_at: '2026-03-29T10:00:00Z',
  };
  function baseProviders(overrides: {
    list?: ReturnType<typeof vi.fn>;
    reviewReminder?: unknown;
    aniListIntegration?: unknown;
  } = {}) {
    return [
      { provide: AuthStore, useValue: { isAuthenticated: () => true } },
      { provide: NotificationsClientService, useValue: { list: overrides.list ?? vi.fn().mockReturnValue(of(notificationsResponse)), markRead: vi.fn(), acceptInvite: vi.fn(), rejectInvite: vi.fn() } },
      { provide: ReviewReminderService, useValue: { loadReminder: vi.fn(() => of(overrides.reviewReminder ?? null)), dismissReminder: vi.fn() } },
      {
        provide: UsersClientService,
        useValue: {
          getAniListIntegration: vi.fn(() => of(overrides.aniListIntegration ?? null)),
          getApiKeyStatus: vi.fn(() => of({ has_key: false, created_at: null, last_used_at: null })),
          createApiKey: vi.fn(),
          upsertAniListIntegration: vi.fn(),
          deleteAniListIntegration: vi.fn(),
          updateMe: vi.fn(),
        },
      },
      { provide: AlbumStore, useValue: { load: vi.fn().mockReturnValue(of([])) } },
      { provide: MatDialog, useValue: { open: vi.fn() } },
    ];
  }

  it('loads notifications for authenticated users and shows unread count', async () => {
    const list = vi.fn().mockReturnValue(of(notificationsResponse));

    await TestBed.configureTestingModule({
      imports: [NavbarNotificationsComponent, NoopAnimationsModule],
      providers: baseProviders({ list, reviewReminder }),
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarNotificationsComponent);
    fixture.detectChanges();

    expect(list).toHaveBeenCalledWith({ page_size: 8 });
    expect(fixture.componentInstance.unreadCount()).toBe(4);

    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const overlayText = overlayContainer.getContainerElement().textContent ?? '';
    expect(overlayText).toContain('Some uploaded media still need names');
    expect(overlayText).toContain('Add your AniList token');
    expect(overlayText).toContain('Open settings');
    expect(overlayText).toContain('Review now');
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
        { provide: ReviewReminderService, useValue: { loadReminder: vi.fn(() => of(null)), dismissReminder: vi.fn() } },
        { provide: UsersClientService, useValue: { getAniListIntegration: vi.fn() } },
        { provide: AlbumStore, useValue: { load: vi.fn().mockReturnValue(of([])) } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
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
      providers: baseProviders({ list }),
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarNotificationsComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(overlayContainer.getContainerElement().textContent).toContain('Unable to load notifications.');
  });

  it('opens settings from the AniList reminder and can dismiss it', async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarNotificationsComponent, NoopAnimationsModule],
      providers: baseProviders(),
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarNotificationsComponent);
    fixture.detectChanges();
    const openSettings = vi.spyOn(fixture.componentInstance, 'openAniListSettings').mockImplementation(() => undefined);

    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const buttons = Array.from(overlayContainer.getContainerElement().querySelectorAll('button'));
    const openSettingsButton = buttons.find((button) => button.textContent?.includes('Open settings')) as HTMLButtonElement;
    openSettingsButton.click();
    fixture.detectChanges();

    expect(openSettings).toHaveBeenCalled();

    const dismissButtons = Array.from(overlayContainer.getContainerElement().querySelectorAll('button'));
    const dismissButton = dismissButtons.find((button) =>
      button.textContent?.includes('Dismiss')
        && button.closest('.notification-item')?.textContent?.includes('Add your AniList token'),
    ) as HTMLButtonElement;
    dismissButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.notifications().some((item) => item.id === 'local:anilist-setup')).toBe(false);
  });

  it('does not prepend the AniList reminder when a token is already connected', async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarNotificationsComponent, NoopAnimationsModule],
      providers: baseProviders({
        aniListIntegration: {
          service: 'anilist',
          created_at: '2026-04-05T10:00:00Z',
          updated_at: '2026-04-05T10:00:00Z',
        },
      }),
    }).compileComponents();

    const fixture = TestBed.createComponent(NavbarNotificationsComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.notifications().some((item) => item.id === 'local:anilist-setup')).toBe(false);
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
        { provide: ReviewReminderService, useValue: { loadReminder: vi.fn(() => of(null)), dismissReminder: vi.fn() } },
        { provide: AlbumStore, useValue: { load: loadAlbums } },
      ],
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarNotificationsComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    fixture.componentInstance.acceptInvite(notificationsResponse.items[0], new MouseEvent('click'));

    expect(acceptInvite).toHaveBeenCalledWith('n1');
    expect(loadAlbums).toHaveBeenCalled();

    fixture.componentInstance.rejectInvite(notificationsResponse.items[0], new MouseEvent('click'));

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
        { provide: ReviewReminderService, useValue: { loadReminder: vi.fn(() => of(null)), dismissReminder: vi.fn() } },
        { provide: AlbumStore, useValue: { load: vi.fn().mockReturnValue(of([])) } },
      ],
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarNotificationsComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    fixture.componentInstance.markRead(notificationsResponse.items[1], new MouseEvent('click'));
    await Promise.resolve();
    fixture.detectChanges();

    expect(markRead).toHaveBeenCalledWith('n2');
  });

});
