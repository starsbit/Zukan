import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '../../../../services/auth.service';
import { AuthStore } from '../../../../services/web/auth.store';
import { NotificationsClientService } from '../../../../services/web/notifications-client.service';
import { ThemeService } from '../../../../services/theme.service';
import { MediaService } from '../../../../services/media.service';
import { UserStore } from '../../../../services/user.store';
import { NavbarActionsComponent } from './navbar-actions.component';

describe('NavbarActionsComponent', () => {
  it('renders the upload action, notifications, and profile button', async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarActionsComponent],
      providers: [
        {
          provide: AuthService,
          useValue: { logout: () => of(void 0) },
        },
        { provide: AuthStore, useValue: { isAuthenticated: () => false } },
        { provide: MediaService, useValue: { upload: () => of({ accepted: 1 }) } },
        { provide: NotificationsClientService, useValue: { list: () => undefined } },
        { provide: ThemeService, useValue: { preference: () => 'system', cycle: () => {} } },
        {
          provide: UserStore,
          useValue: {
            currentUser: () => ({ username: 'stars', email: 'stars@example.com', is_admin: false }),
            isAdmin: () => false,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NavbarActionsComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('zukan-navbar-upload')).not.toBeNull();
    expect(element.querySelector('zukan-navbar-theme-toggle')).not.toBeNull();
    expect(element.querySelector('zukan-navbar-notifications')).not.toBeNull();
    expect(element.querySelector('zukan-navbar-profile')).not.toBeNull();
  });
});
