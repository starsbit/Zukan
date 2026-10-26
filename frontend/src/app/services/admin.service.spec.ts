import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminService } from './admin.service';
import { UserStore } from './user.store';
import { API_BASE_URL } from './web/api.config';
import { AnnouncementSeverity } from '../models/notifications';

function makeUser(is_admin: boolean) {
  return {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    is_admin,
    show_nsfw: false,
    tag_confidence_threshold: 0.5,
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    storage_used_mb: 0,
  };
}

describe('AdminService', () => {
  let service: AdminService;
  let userStore: UserStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(AdminService);
    userStore = TestBed.inject(UserStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('when user is admin', () => {
    beforeEach(() => userStore.set(makeUser(true)));

    it('getStats sends GET /api/v1/admin/stats', () => {
      const mock = {
        total_media: 100,
        total_storage_bytes: 1024,
        pending_tagging: 0,
        failed_tagging: 0,
        trashed_media: 0,
      };
      service.getStats().subscribe((res) => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/stats');
      expect(req.request.method).toBe('GET');
      req.flush(mock);
    });

    it('getHealth sends GET /api/v1/admin/health', () => {
      const mock = {
        generated_at: '2026-04-02T10:00:00Z',
        uptime_seconds: 42,
        cpu_percent: 10,
        memory_rss_bytes: 1024,
        system_memory_total_bytes: 4096,
        system_memory_used_bytes: 2048,
        tagging_queue_depth: 2,
        samples: [],
      };
      service.getHealth().subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/health');
      expect(req.request.method).toBe('GET');
      req.flush(mock);
    });

    it('retagAll sends POST /api/v1/admin/users/{id}/tagging-jobs', () => {
      const mock = { queued_count: 42 };
      service.retagAll().subscribe((res) => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/tagging-jobs');
      expect(req.request.method).toBe('POST');
      req.flush(mock);
    });

    it('startEmbeddingBackfill sends POST /api/v1/admin/users/{id}/embedding-backfill', () => {
      const mock = { batch_id: 'b1', queued: 3, already_current: 7 };
      service.startEmbeddingBackfill().subscribe((res) => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/embedding-backfill');
      expect(req.request.method).toBe('POST');
      req.flush(mock);
    });

    it('getEmbeddingBackfillStatus sends GET /api/v1/admin/embedding-backfills/{id}', () => {
      const mock = {
        batch_id: 'b1',
        user_id: 'u2',
        status: 'done',
        total_items: 3,
        queued_items: 0,
        processing_items: 0,
        done_items: 3,
        failed_items: 0,
        started_at: '2026-04-25T10:00:00Z',
        finished_at: '2026-04-25T10:01:00Z',
        error_summary: null,
        recent_failed_items: [],
      };
      service.getEmbeddingBackfillStatus('b1').subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/embedding-backfills/b1');
      expect(req.request.method).toBe('GET');
      req.flush(mock);
    });

    it('getLibraryClassificationMetrics sends GET /api/v1/admin/users/{id}/library-classification-metrics', () => {
      const mock = {
        user_id: 'u2',
        model_version: 'clip_onnx_v1',
        reviewed: 4,
        accepted: 3,
        rejected: 1,
        auto_applied: 2,
        acceptance_rate: 0.75,
        rejection_rate: 0.25,
        by_source: [],
      };
      service.getLibraryClassificationMetrics().subscribe((res) => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/library-classification-metrics');
      expect(req.request.method).toBe('GET');
      req.flush(mock);
    });

    it('listAnnouncements sends GET /api/v1/admin/announcements', () => {
      service.listAnnouncements().subscribe(res => expect(res).toEqual([]));
      const req = http.expectOne('/api/v1/admin/announcements');
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('createAnnouncement sends POST /api/v1/admin/announcements', () => {
      const body = { title: 'Hi', message: 'test', severity: AnnouncementSeverity.INFO };
      const mock = { id: 'n1', version: null, title: 'Hi', message: 'test', severity: AnnouncementSeverity.INFO, starts_at: null, ends_at: null, is_active: true, created_at: '2026-01-01T00:00:00Z' };
      service.createAnnouncement(body).subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/announcements');
      expect(req.request.method).toBe('POST');
      req.flush(mock);
    });
  });
});
