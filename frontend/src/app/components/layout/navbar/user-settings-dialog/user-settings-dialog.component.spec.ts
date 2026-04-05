import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../../services/auth.service';
import { UserStore } from '../../../../services/user.store';
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
    tag_confidence_threshold: 0.5,
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
  it('initializes the form from the current user', async () => {
    await TestBed.configureTestingModule({
      imports: [UserSettingsDialogComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: UserStore, useValue: { currentUser: () => user, set: vi.fn() } },
        { provide: UsersClientService, useValue: baseUsersClient() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UserSettingsDialogComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({
      showNsfw: false,
      tagConfidenceThreshold: 0.5,
      password: '',
      confirmPassword: '',
    });
  });

  it('saves settings to the backend and updates the user store', async () => {
    const set = vi.fn();
    const updatedUser = { ...user, show_nsfw: true, tag_confidence_threshold: 0.75, version: 4 };
    const updateMe = vi.fn().mockReturnValue(of(updatedUser));

    await TestBed.configureTestingModule({
      imports: [UserSettingsDialogComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: UserStore, useValue: { currentUser: () => user, set } },
        { provide: UsersClientService, useValue: baseUsersClient({ updateMe }) },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UserSettingsDialogComponent);
    fixture.detectChanges();

    fixture.componentInstance.form.patchValue({
      showNsfw: true,
      tagConfidenceThreshold: 0.75,
      password: 'Secret123!',
      confirmPassword: 'Secret123!',
    });
    fixture.componentInstance.save();

    expect(updateMe).toHaveBeenCalledWith({
      show_nsfw: true,
      tag_confidence_threshold: 0.75,
      version: 3,
      password: 'Secret123!',
    });
    expect(set).toHaveBeenCalledWith(updatedUser);
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
        { provide: AuthService, useValue: { logout: () => of(void 0) } },
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
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(UserSettingsDialogComponent);
    fixture.detectChanges();

    const idInput = fixture.nativeElement.querySelector('input[disabled]') as HTMLInputElement;
    expect(idInput.value).toBe(user.id);
    expect(fixture.nativeElement.textContent).toContain('Active');
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
});
