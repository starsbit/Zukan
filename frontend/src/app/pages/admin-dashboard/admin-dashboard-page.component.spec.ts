import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { AdminDashboardPageComponent } from './admin-dashboard-page.component';
import { AdminService } from '../../services/admin.service';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { UserStore } from '../../services/user.store';
import { LOCAL_STORAGE, SESSION_STORAGE } from '../../services/web/auth.store';
import { AnnouncementSeverity } from '../../models/notifications';

const storageStub: Storage = {
  length: 0,
  clear: () => undefined,
  getItem: () => null,
  key: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

describe('AdminDashboardPageComponent', () => {
  async function configureDashboardTestingModule() {
    await TestBed.configureTestingModule({
      imports: [AdminDashboardPageComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        {
          provide: AdminService,
          useValue: {
            getStats: () => of({
              total_users: 2,
              total_media: 5,
              total_storage_bytes: 2048,
              pending_tagging: 1,
              failed_tagging: 0,
              trashed_media: 1,
              storage_by_user: [
                { user_id: 'u1', username: 'admin', media_count: 3, storage_used_mb: 1024 },
                { user_id: 'u2', username: 'alice', media_count: 2, storage_used_mb: 1024 },
              ],
            }),
            getHealth: () => of({
              generated_at: '2026-04-02T10:00:00Z',
              uptime_seconds: 42,
              cpu_percent: 12,
              memory_rss_bytes: 1024,
              system_memory_total_bytes: 8192,
              system_memory_used_bytes: 4096,
              tagging_queue_depth: 2,
              samples: [{ captured_at: '2026-04-02T10:00:00Z', cpu_percent: 12, memory_rss_bytes: 1024 }],
            }),
            listUsers: () => of({
              total: 2,
              page: 1,
              page_size: 200,
              items: [
                {
                  id: 'u1',
                  username: 'admin',
                  email: 'admin@example.com',
                  is_admin: true,
                  show_nsfw: false,
                  tag_confidence_threshold: 0.5,
                  version: 1,
                  created_at: '2026-04-01T00:00:00Z',
                  media_count: 3,
                  storage_used_mb: 1,
                  storage_quota_mb: 10240,
                },
                {
                  id: 'u2',
                  username: 'alice',
                  email: 'alice@example.com',
                  is_admin: false,
                  show_nsfw: false,
                  tag_confidence_threshold: 0.5,
                  version: 1,
                  created_at: '2026-04-02T00:00:00Z',
                  media_count: 2,
                  storage_used_mb: 1,
                  storage_quota_mb: 10240,
                },
              ],
            }),
            listAnnouncements: () => of([
              {
                id: 'a1',
                version: '1.0.0',
                title: 'Maintenance',
                message: 'Nightly backup',
                severity: AnnouncementSeverity.INFO,
                starts_at: null,
                ends_at: null,
                is_active: true,
                created_at: '2026-04-02T10:00:00Z',
              },
            ]),
            createAnnouncement: () => of({}),
            updateUser: () => of({ id: 'u2', username: 'alice2' }),
            retagAll: () => of({ queued: 2 }),
            deleteUserMedia: () => of({ deleted: 2 }),
            deleteUser: () => of(void 0),
          },
        },
        { provide: ConfirmDialogService, useValue: { open: () => of(true) } },
        { provide: LOCAL_STORAGE, useValue: storageStub },
        { provide: SESSION_STORAGE, useValue: storageStub },
        {
          provide: UserStore,
          useValue: {
            currentUser: () => ({
              id: 'u1',
              username: 'admin',
              email: 'admin@example.com',
              is_admin: true,
              show_nsfw: false,
              tag_confidence_threshold: 0.5,
              version: 1,
              created_at: '2026-04-01T00:00:00Z',
            }),
            isAdmin: () => true,
            update: () => undefined,
          },
        },
      ],
    }).compileComponents();
  }

  it('renders dashboard data and exposes user actions', async () => {
    await configureDashboardTestingModule();

    const fixture = TestBed.createComponent(AdminDashboardPageComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Platform dashboard');
    expect(text).toContain('Maintenance');
    expect(text).toContain('alice@example.com');
    expect(text).toContain('Delete Media');
  });

  it('renders the responsive grid hooks used by the narrow-screen layout', async () => {
    await configureDashboardTestingModule();

    const fixture = TestBed.createComponent(AdminDashboardPageComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.content-grid')).not.toBeNull();
    expect(element.querySelector('.chart-grid')).not.toBeNull();
    expect(element.querySelector('.announcement-form')).not.toBeNull();
  });

  it('keeps a single-column mobile breakpoint for the admin grids', async () => {
    await configureDashboardTestingModule();

    const fixture = TestBed.createComponent(AdminDashboardPageComponent);
    fixture.detectChanges();

    const styles = Array.from(document.querySelectorAll('style'))
      .map((node) => node.textContent ?? '')
      .join('\n');

    expect(styles).toContain('@media (max-width: 1023px)');
    expect(styles).toContain('.content-grid');
    expect(styles).toContain('.chart-grid');
    expect(styles).toContain('.announcement-form');
    expect(styles).toMatch(/@media \(max-width: 1023px\)[\s\S]*grid-template-columns:\s*1fr;/);
    expect(styles).toContain('grid-template-columns: 1fr;');
  });
});
