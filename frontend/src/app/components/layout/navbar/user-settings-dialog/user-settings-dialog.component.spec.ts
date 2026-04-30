import { Clipboard } from '@angular/cdk/clipboard';
import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../../services/auth.service';
import { CollectionVisibility } from '../../../../models/collection';
import { GalleryStore } from '../../../../services/gallery.store';
import { UserStore } from '../../../../services/user.store';
import { CollectionClientService } from '../../../../services/web/collection-client.service';
import { UsersClientService } from '../../../../services/web/users-client.service';
import { NavbarProfileComponent } from '../navbar-profile/navbar-profile.component';
import { UserSettingsDialogComponent } from './user-settings-dialog.component';

describe('UserSettingsDialogComponent', () => {
  const user = {
    id: 'u1',
    username: 'stars',
    email: 'saber@starsbit.space',
    is_admin: true,
    show_nsfw: false,
    show_sensitive: false,
    tag_confidence_threshold: 0.5,
    library_classification_enabled: false,
    version: 3,
    created_at: '2026-03-28T00:00:00Z',
  };
  const apiKeyStatus = {
    has_key: true,
    created_at: '2026-04-02T09:15:00Z',
    last_used_at: '2026-04-02T10:30:00Z',
  };

  function baseUsersClient(overrides: Record<string, unknown> = {}) {
    return {
      updateMe: vi.fn(),
      getApiKeyStatus: vi.fn().mockReturnValue(of(apiKeyStatus)),
      createApiKey: vi.fn(),
      ...overrides,
    };
  }

  function baseCollectionClient(overrides: Record<string, unknown> = {}) {
    return {
      getPrivacy: vi.fn().mockReturnValue(of({
        user_id: 'u1',
        visibility: CollectionVisibility.PUBLIC,
        allow_trade_requests: true,
        show_stats: true,
        show_nsfw: false,
      })),
      updatePrivacy: vi.fn().mockReturnValue(of({
        user_id: 'u1',
        visibility: CollectionVisibility.PUBLIC,
        allow_trade_requests: true,
        show_stats: true,
        show_nsfw: false,
      })),
      ...overrides,
    };
  }

  function baseGalleryStore(overrides: Record<string, unknown> = {}) {
    return {
      refresh: vi.fn().mockReturnValue(of({})),
      ...overrides,
    };
  }

  it('initializes the form from the current user', async () => {
    await TestBed.configureTestingModule({
      imports: [UserSettingsDialogComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: UserStore, useValue: { currentUser: () => user, set: vi.fn() } },
        { provide: UsersClientService, useValue: baseUsersClient() },
        { provide: CollectionClientService, useValue: baseCollectionClient() },
        { provide: GalleryStore, useValue: baseGalleryStore() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UserSettingsDialogComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({
      showNsfw: false,
      showSensitive: false,
      tagConfidenceThreshold: 0.5,
      libraryClassificationEnabled: false,
      collectionVisibility: CollectionVisibility.PUBLIC,
      password: '',
      confirmPassword: '',
    });
  });

  it('saves settings to the backend and updates the user store', async () => {
    const set = vi.fn();
    const refresh = vi.fn().mockReturnValue(of({}));
    const updatedUser = {
      ...user,
      show_nsfw: true,
      show_sensitive: true,
      tag_confidence_threshold: 0.75,
      library_classification_enabled: true,
      version: 4,
    };
    const updateMe = vi.fn().mockReturnValue(of(updatedUser));

    await TestBed.configureTestingModule({
      imports: [UserSettingsDialogComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: UserStore, useValue: { currentUser: () => user, set } },
        { provide: UsersClientService, useValue: baseUsersClient({ updateMe }) },
        { provide: CollectionClientService, useValue: baseCollectionClient() },
        { provide: GalleryStore, useValue: baseGalleryStore({ refresh }) },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UserSettingsDialogComponent);
    fixture.detectChanges();

    fixture.componentInstance.form.patchValue({
      showNsfw: true,
      showSensitive: true,
      tagConfidenceThreshold: 0.75,
      libraryClassificationEnabled: true,
      password: 'Secret123!',
      confirmPassword: 'Secret123!',
    });
    fixture.componentInstance.save();

    expect(updateMe).toHaveBeenCalledWith({
      show_nsfw: true,
      show_sensitive: true,
      tag_confidence_threshold: 0.75,
      library_classification_enabled: true,
      version: 3,
      password: 'Secret123!',
    });
    expect(set).toHaveBeenCalledWith(updatedUser);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows an error when password confirmation does not match', async () => {
    const updateMe = vi.fn();

    await TestBed.configureTestingModule({
      imports: [UserSettingsDialogComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: UserStore, useValue: { currentUser: () => user, set: vi.fn() } },
        { provide: UsersClientService, useValue: baseUsersClient({ updateMe }) },
        { provide: CollectionClientService, useValue: baseCollectionClient() },
        { provide: GalleryStore, useValue: baseGalleryStore() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UserSettingsDialogComponent);
    fixture.detectChanges();

    fixture.componentInstance.form.patchValue({
      password: 'Secret123!',
      confirmPassword: 'Mismatch123!',
    });
    fixture.componentInstance.save();
    fixture.detectChanges();

    expect(updateMe).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Passwords do not match.');
  });

  it('renders inside the account settings dialog opened from the profile menu', async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarProfileComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: UserStore, useValue: { currentUser: () => user, isAdmin: () => true } },
        { provide: UsersClientService, useValue: baseUsersClient({ updateMe: vi.fn().mockReturnValue(of(user)) }) },
        { provide: CollectionClientService, useValue: baseCollectionClient() },
        { provide: AuthService, useValue: { logout: () => of(void 0) } },
        { provide: GalleryStore, useValue: baseGalleryStore() },
      ],
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarProfileComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    (host.querySelector('button[aria-label="Profile"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const overlay = overlayContainer.getContainerElement();
    (overlay.querySelector('.profile-actions button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(overlayContainer.getContainerElement().textContent).toContain('Account Settings');
  });

  it('shows backend save errors', async () => {
    const updateMe = vi.fn().mockReturnValue(throwError(() => ({ error: { detail: 'Version conflict' } })));

    await TestBed.configureTestingModule({
      imports: [UserSettingsDialogComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: UserStore, useValue: { currentUser: () => user, set: vi.fn() } },
        { provide: UsersClientService, useValue: baseUsersClient({ updateMe }) },
        { provide: CollectionClientService, useValue: baseCollectionClient() },
        { provide: GalleryStore, useValue: baseGalleryStore() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UserSettingsDialogComponent);
    fixture.detectChanges();

    fixture.componentInstance.save();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Version conflict');
  });

  it('renders the user id and api key status', async () => {
    await TestBed.configureTestingModule({
      imports: [UserSettingsDialogComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: UserStore, useValue: { currentUser: () => user, set: vi.fn() } },
        { provide: UsersClientService, useValue: baseUsersClient() },
        { provide: CollectionClientService, useValue: baseCollectionClient() },
        { provide: GalleryStore, useValue: baseGalleryStore() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UserSettingsDialogComponent);
    fixture.detectChanges();

    const idInput = fixture.nativeElement.querySelector('input[disabled]') as HTMLInputElement;
    expect(idInput.value).toBe(user.id);
    expect(fixture.nativeElement.textContent).toContain('Active');
  });

  it('marks password inputs as new-password fields', async () => {
    await TestBed.configureTestingModule({
      imports: [UserSettingsDialogComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: UserStore, useValue: { currentUser: () => user, set: vi.fn() } },
        { provide: UsersClientService, useValue: baseUsersClient() },
        { provide: CollectionClientService, useValue: baseCollectionClient() },
        { provide: GalleryStore, useValue: baseGalleryStore() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UserSettingsDialogComponent);
    fixture.detectChanges();

    const passwordInputs = Array.from(
      fixture.nativeElement.querySelectorAll('input[type="password"]'),
    ) as HTMLInputElement[];

    expect(passwordInputs).toHaveLength(2);
    expect(passwordInputs.every((input) => input.getAttribute('autocomplete') === 'new-password')).toBe(true);
  });

  it('creates an api key and shows the raw value once', async () => {
    const createApiKey = vi.fn().mockReturnValue(of({ ...apiKeyStatus, api_key: 'zk_created_key' }));

    await TestBed.configureTestingModule({
      imports: [UserSettingsDialogComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: UserStore, useValue: { currentUser: () => user, set: vi.fn() } },
        { provide: UsersClientService, useValue: baseUsersClient({ createApiKey }) },
        { provide: CollectionClientService, useValue: baseCollectionClient() },
        { provide: GalleryStore, useValue: baseGalleryStore() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UserSettingsDialogComponent);
    fixture.detectChanges();

    fixture.componentInstance.createApiKey();
    fixture.detectChanges();

    expect(createApiKey).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('zk_created_key');
    expect(fixture.nativeElement.textContent).toContain('This key is only shown once');
  });

  it('copies a newly created api key to the clipboard', async () => {
    const createApiKey = vi.fn().mockReturnValue(of({ ...apiKeyStatus, api_key: 'zk_created_key' }));

    await TestBed.configureTestingModule({
      imports: [UserSettingsDialogComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: UserStore, useValue: { currentUser: () => user, set: vi.fn() } },
        { provide: UsersClientService, useValue: baseUsersClient({ createApiKey }) },
        { provide: CollectionClientService, useValue: baseCollectionClient() },
        { provide: GalleryStore, useValue: baseGalleryStore() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UserSettingsDialogComponent);
    fixture.detectChanges();

    const copy = vi.spyOn((fixture.componentInstance as never as { clipboard: Clipboard }).clipboard, 'copy').mockReturnValue(true);
    const open = vi.spyOn((fixture.componentInstance as never as { snackBar: MatSnackBar }).snackBar, 'open');

    fixture.componentInstance.createApiKey();
    fixture.detectChanges();

    fixture.componentInstance.copyApiKey();

    expect(copy).toHaveBeenCalledWith('zk_created_key');
    expect(open).toHaveBeenCalledWith('API key copied.', 'Close', { duration: 3000 });
  });

  it('shows an error when copying the api key fails', async () => {
    const createApiKey = vi.fn().mockReturnValue(of({ ...apiKeyStatus, api_key: 'zk_created_key' }));

    await TestBed.configureTestingModule({
      imports: [UserSettingsDialogComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: UserStore, useValue: { currentUser: () => user, set: vi.fn() } },
        { provide: UsersClientService, useValue: baseUsersClient({ createApiKey }) },
        { provide: CollectionClientService, useValue: baseCollectionClient() },
        { provide: GalleryStore, useValue: baseGalleryStore() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UserSettingsDialogComponent);
    fixture.detectChanges();

    const copy = vi.spyOn((fixture.componentInstance as never as { clipboard: Clipboard }).clipboard, 'copy').mockReturnValue(false);
    const open = vi.spyOn((fixture.componentInstance as never as { snackBar: MatSnackBar }).snackBar, 'open');

    fixture.componentInstance.createApiKey();
    fixture.detectChanges();

    fixture.componentInstance.copyApiKey();

    expect(copy).toHaveBeenCalledWith('zk_created_key');
    expect(open).toHaveBeenCalledWith('Unable to copy API key.', 'Close', { duration: 4000 });
  });
});
