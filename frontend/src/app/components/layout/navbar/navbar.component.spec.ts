import { BreakpointObserver } from '@angular/cdk/layout';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { TagsClientService } from '../../../services/web/tags-client.service';
import { MediaClientService } from '../../../services/web/media-client.service';
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
  function createBreakpointObserver(matches = false) {
    const state$ = new BehaviorSubject({ matches, breakpoints: {} as Record<string, boolean> });
    return {
      observer: {
        observe: () => state$.asObservable(),
      },
      setMatches(next: boolean) {
        state$.next({ matches: next, breakpoints: {} });
      },
    };
  }

  it('renders the brand, search, and actions items', async () => {
    const breakpoint = createBreakpointObserver();
    await TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideRouter([]),
        { provide: BreakpointObserver, useValue: breakpoint.observer },
        { provide: TagsClientService, useValue: { list: () => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 6 }) } },
        { provide: MediaClientService, useValue: { getCharacterSuggestions: () => of([]), getSeriesSuggestions: () => of([]) } },
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

  it('shows a menu toggle button when enabled', async () => {
    const breakpoint = createBreakpointObserver();
    await TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideRouter([]),
        { provide: BreakpointObserver, useValue: breakpoint.observer },
        { provide: TagsClientService, useValue: { list: () => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 6 }) } },
        { provide: MediaClientService, useValue: { getCharacterSuggestions: () => of([]), getSeriesSuggestions: () => of([]) } },
        { provide: ThemeService, useValue: { preference: () => 'system', cycle: () => {} } },
        { provide: LOCAL_STORAGE, useValue: storageMock },
        { provide: SESSION_STORAGE, useValue: storageMock },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NavbarComponent);
    fixture.componentRef.setInput('showMenuToggle', true);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.navbar-menu-toggle')).not.toBeNull();
  });

  it('renders the mobile search trigger in the shared navbar at mobile widths', async () => {
    const breakpoint = createBreakpointObserver(true);
    await TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideRouter([]),
        { provide: BreakpointObserver, useValue: breakpoint.observer },
        { provide: TagsClientService, useValue: { list: () => of({ items: [], total: 0, next_cursor: null, has_more: false, page_size: 6 }) } },
        { provide: MediaClientService, useValue: { getCharacterSuggestions: () => of([]), getSeriesSuggestions: () => of([]) } },
        { provide: ThemeService, useValue: { preference: () => 'system', cycle: () => {} } },
        { provide: LOCAL_STORAGE, useValue: storageMock },
        { provide: SESSION_STORAGE, useValue: storageMock },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NavbarComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.search-mobile-trigger')).not.toBeNull();
  });
});
