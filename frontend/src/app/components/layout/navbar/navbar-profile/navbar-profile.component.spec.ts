import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../../services/auth.service';
import { UserStore } from '../../../../services/user.store';
import { NavbarProfileComponent } from './navbar-profile.component';

describe('NavbarProfileComponent', () => {
  const makeUserStore = (isAdmin: boolean) => ({
    currentUser: () => ({
      id: 'u1',
      username: 'stars',
      email: 'saber@starsbit.space',
      is_admin: isAdmin,
      show_nsfw: false,
      tag_confidence_threshold: 0.5,
      version: 1,
      created_at: '2026-03-28T00:00:00Z',
    }),
    isAdmin: () => isAdmin,
  });

  it('derives the avatar letter from the username and renders profile details', async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarProfileComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: () => of(void 0) } },
        { provide: UserStore, useValue: makeUserStore(false) },
      ],
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarProfileComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.avatarLetter()).toBe('S');

    const host = fixture.nativeElement as HTMLElement;
    (host.querySelector('button[aria-label="Profile"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const overlayText = overlayContainer.getContainerElement().textContent ?? '';
    expect(overlayText).toContain('stars');
    expect(overlayText).toContain('saber@starsbit.space');
    expect(overlayText).not.toContain('Administration');
  });

  it('shows the admin action only for admins', async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarProfileComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: () => of(void 0) } },
        { provide: UserStore, useValue: makeUserStore(true) },
      ],
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarProfileComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    (host.querySelector('button[aria-label="Profile"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const adminLink = overlayContainer
      .getContainerElement()
      .querySelector('a[routerlink="/admin"]');
    expect(adminLink).not.toBeNull();
  });

  it('links help and feedback to the issue form and signs out from the menu', async () => {
    const logout = vi.fn().mockReturnValue(of(void 0));

    await TestBed.configureTestingModule({
      imports: [NavbarProfileComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout } },
        { provide: UserStore, useValue: makeUserStore(true) },
      ],
    }).compileComponents();

    const overlayContainer = TestBed.inject(OverlayContainer);
    const fixture = TestBed.createComponent(NavbarProfileComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    (host.querySelector('button[aria-label="Profile"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const overlay = overlayContainer.getContainerElement();
    const feedbackLink = overlay.querySelector('a[href="https://github.com/starsbit/Zukan/issues/new"]');
    expect(feedbackLink).not.toBeNull();

    (overlay.querySelector('.sign-out-button') as HTMLButtonElement).click();
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
