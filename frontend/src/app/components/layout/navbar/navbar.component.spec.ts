import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LOCAL_STORAGE, SESSION_STORAGE } from '../../../services/web/auth.store';
import { ThemeService } from '../../../services/theme.service';
import { NavbarComponent } from './navbar.component';

const storageMock: Storage = {
  length: 0,
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
};

describe('NavbarComponent', () => {
  it('renders the brand, search, and actions items', async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideRouter([]),
        { provide: ThemeService, useValue: { preference: () => 'system', cycle: () => {} } },
        { provide: LOCAL_STORAGE, useValue: storageMock },
        { provide: SESSION_STORAGE, useValue: storageMock },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NavbarComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('zukan-navbar-brand')).not.toBeNull();
    expect(element.querySelector('zukan-navbar-search')).not.toBeNull();
    expect(element.querySelector('zukan-navbar-actions')).not.toBeNull();
  });
});
