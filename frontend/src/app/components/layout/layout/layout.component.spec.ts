import { TestBed } from '@angular/core/testing';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { LayoutComponent } from './layout.component';
import { ThemeService } from '../../../services/theme.service';
import { UploadTrackerService } from '../../../services/upload-tracker.service';
import { LOCAL_STORAGE, SESSION_STORAGE } from '../../../services/web/auth.store';

const mockThemeService = {
  preference: () => 'system',
  cycle: () => {},
};

describe('LayoutComponent', () => {
  let breakpointState$: BehaviorSubject<BreakpointState>;

  function storageStub(): Storage {
    return {
      length: 0,
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {},
      setItem: () => {},
    };
  }

  function uploadTrackerStub() {
    return {
      summary: () => ({
        requestCounts: { queued: 0, uploading: 0, completed: 0, failed: 0 },
        itemCounts: { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0, duplicate: 0, upload_error: 0 },
        reviewItems: 0,
        reviewBatchCount: 0,
        latestReviewBatchId: null,
        totalTrackedItems: 0,
        completedItems: 0,
        progressPercent: 0,
        activeBatchCount: 0,
        hasActiveWork: false,
        latestBatch: null,
      }),
      countChips: () => [],
      visible: () => false,
      dismiss: () => {},
    };
  }

  beforeEach(() => {
    breakpointState$ = new BehaviorSubject<BreakpointState>({
      matches: false,
      breakpoints: { '(max-width: 1023px)': false },
    });
  });

  async function configureLayoutTestingModule() {
    await TestBed.configureTestingModule({
      imports: [LayoutComponent],
      providers: [
        provideRouter([]),
        { provide: BreakpointObserver, useValue: { observe: () => breakpointState$.asObservable() } },
        { provide: ThemeService, useValue: mockThemeService },
        { provide: UploadTrackerService, useValue: uploadTrackerStub() },
        { provide: LOCAL_STORAGE, useValue: storageStub() },
        { provide: SESSION_STORAGE, useValue: storageStub() },
      ],
    }).compileComponents();
  }

  it('renders the navbar and sidebar shell', async () => {
    await configureLayoutTestingModule();

    const fixture = TestBed.createComponent(LayoutComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('zukan-navbar')).not.toBeNull();
    expect(element.querySelector('zukan-sidebar')).not.toBeNull();
    expect(element.querySelector('zukan-navbar-brand')).not.toBeNull();
    expect(element.querySelector('zukan-upload-status-island')).not.toBeNull();
  });

  it('starts with the sidebar closed on mobile viewports', async () => {
    breakpointState$.next({
      matches: true,
      breakpoints: { '(max-width: 1023px)': true },
    });
    await configureLayoutTestingModule();

    const fixture = TestBed.createComponent(LayoutComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.sidenavOpened()).toBe(false);
  });

  it('starts with the sidebar open on desktop viewports', async () => {
    await configureLayoutTestingModule();

    const fixture = TestBed.createComponent(LayoutComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.sidenavOpened()).toBe(true);
  });

  it('toggleSidenav opens the sidebar when it is closed', async () => {
    breakpointState$.next({
      matches: true,
      breakpoints: { '(max-width: 1023px)': true },
    });
    await configureLayoutTestingModule();

    const fixture = TestBed.createComponent(LayoutComponent);
    fixture.detectChanges();

    fixture.componentInstance.toggleSidenav();

    expect(fixture.componentInstance.sidenavOpened()).toBe(true);
  });

  it('renders the mobile sidebar as an overlay without compressing content', async () => {
    breakpointState$.next({
      matches: true,
      breakpoints: { '(max-width: 1023px)': true },
    });
    await configureLayoutTestingModule();

    const fixture = TestBed.createComponent(LayoutComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const sidebar = element.querySelector('.layout-sidebar');
    expect(sidebar?.classList.contains('layout-sidebar--mobile')).toBe(true);
    expect(sidebar?.classList.contains('layout-sidebar--open')).toBe(false);
    expect(sidebar?.getAttribute('aria-hidden')).toBe('true');
    expect(element.querySelector('.layout-backdrop')).toBeNull();

    fixture.componentInstance.toggleSidenav();
    fixture.detectChanges();

    expect(sidebar?.classList.contains('layout-sidebar--open')).toBe(true);
    expect(sidebar?.getAttribute('aria-hidden')).toBe('false');
    expect(element.querySelector('.layout-backdrop')).not.toBeNull();

    breakpointState$.next({
      matches: false,
      breakpoints: { '(max-width: 1023px)': false },
    });
    fixture.detectChanges();

    expect(sidebar?.classList.contains('layout-sidebar--mobile')).toBe(false);
    expect(sidebar?.classList.contains('layout-sidebar--open')).toBe(true);
  });

  it('closeSidenav only closes the mobile overlay', async () => {
    await configureLayoutTestingModule();

    const fixture = TestBed.createComponent(LayoutComponent);
    fixture.detectChanges();

    fixture.componentInstance.closeSidenav();
    expect(fixture.componentInstance.sidenavOpened()).toBe(true);

    breakpointState$.next({
      matches: true,
      breakpoints: { '(max-width: 1023px)': true },
    });
    fixture.detectChanges();

    fixture.componentInstance.toggleSidenav();
    fixture.componentInstance.closeSidenav();
    expect(fixture.componentInstance.sidenavOpened()).toBe(false);
  });
});
