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
    id: 'u1', username: 'alice', email: 'alice@example.com',
    is_admin, show_nsfw: false, tag_confidence_threshold: 0.5,
    version: 1, created_at: '2026-01-01T00:00:00Z',
    storage_quota_mb: 10240, storage_used_mb: 0,
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

  describe('when user is not admin', () => {
    beforeEach(() => userStore.set(makeUser(false)));

    it('getStats throws Forbidden', () => {
      let err: unknown;
      service.getStats().subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
      http.expectNone('/api/v1/admin/stats');
    });

    it('getHealth throws Forbidden', () => {
      let err: unknown;
      service.getHealth().subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
      http.expectNone('/api/v1/admin/health');
    });

    it('listUsers throws Forbidden', () => {
      let err: unknown;
      service.listUsers().subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });

    it('getUser throws Forbidden', () => {
      let err: unknown;
      service.getUser('u2').subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });

    it('updateUser throws Forbidden', () => {
      let err: unknown;
      service.updateUser('u2', { is_admin: true }).subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });

    it('deleteUser throws Forbidden', () => {
      let err: unknown;
      service.deleteUser('u2').subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });

    it('deleteUserMedia throws Forbidden', () => {
      let err: unknown;
      service.deleteUserMedia('u2').subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });

    it('retagAll throws Forbidden', () => {
      let err: unknown;
      service.retagAll('u2').subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });

    it('startEmbeddingBackfill throws Forbidden', () => {
      let err: unknown;
      service.startEmbeddingBackfill('u2').subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });

    it('getEmbeddingClusters throws Forbidden', () => {
      let err: unknown;
      service.getEmbeddingClusters('u2', 'label').subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });

    it('getEmbeddingClusterPlot throws Forbidden', () => {
      let err: unknown;
      service.getEmbeddingClusterPlot('u2', 'label').subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });

    it('getLibraryClassificationMetrics throws Forbidden', () => {
      let err: unknown;
      service.getLibraryClassificationMetrics('u2').subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });

    it('listAnnouncements throws Forbidden', () => {
      let err: unknown;
      service.listAnnouncements().subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });

    it('createAnnouncement throws Forbidden', () => {
      let err: unknown;
      service.createAnnouncement({ title: 'Hi', message: 'test' }).subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });
  });

  describe('when user is not loaded (null)', () => {
    it('getStats throws Forbidden', () => {
      let err: unknown;
      service.getStats().subscribe({ error: e => (err = e) });
      expect((err as Error).message).toMatch(/Forbidden/);
    });
  });

  describe('when user is admin', () => {
    beforeEach(() => userStore.set(makeUser(true)));

    it('getStats sends GET /api/v1/admin/stats', () => {
      const mock = { total_users: 5, total_media: 100, total_storage_bytes: 1024, pending_tagging: 0, failed_tagging: 0, trashed_media: 0, storage_by_user: [] };
      service.getStats().subscribe(res => expect(res).toEqual(mock));
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

    it('listUsers sends GET /api/v1/admin/users', () => {
      const mock = { items: [], total: 0, page: 1, page_size: 20 };
      service.listUsers().subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/users');
      expect(req.request.method).toBe('GET');
      req.flush(mock);
    });

    it('listUsers passes pagination params', () => {
      service.listUsers({ page: 2, page_size: 10 }).subscribe();
      const req = http.expectOne(r => r.url === '/api/v1/admin/users');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('page_size')).toBe('10');
      req.flush({ items: [], total: 0, page: 2, page_size: 10 });
    });

    it('getUser sends GET /api/v1/admin/users/{id}', () => {
      const mock = { ...makeUser(false), media_count: 0, storage_used_bytes: 0 };
      service.getUser('u2').subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/users/u2');
      expect(req.request.method).toBe('GET');
      req.flush(mock);
    });

    it('updateUser sends PATCH /api/v1/admin/users/{id}', () => {
      const body = { is_admin: true };
      const mock = makeUser(true);
      service.updateUser('u2', body).subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/users/u2');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(body);
      req.flush(mock);
    });

    it('deleteUser sends DELETE /api/v1/admin/users/{id}', () => {
      service.deleteUser('u2').subscribe();
      const req = http.expectOne(r => r.url === '/api/v1/admin/users/u2');
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
    });

    it('deleteUser passes delete_media param', () => {
      service.deleteUser('u2', true).subscribe();
      const req = http.expectOne(r => r.url === '/api/v1/admin/users/u2');
      expect(req.request.params.get('delete_media')).toBe('true');
      req.flush(null, { status: 204, statusText: 'No Content' });
    });

    it('deleteUserMedia sends DELETE /api/v1/admin/users/{id}/media', () => {
      const mock = { deleted: 4 };
      service.deleteUserMedia('u2').subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/users/u2/media');
      expect(req.request.method).toBe('DELETE');
      req.flush(mock);
    });

    it('retagAll sends POST /api/v1/admin/users/{id}/tagging-jobs', () => {
      const mock = { queued_count: 42 };
      service.retagAll('u2').subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/users/u2/tagging-jobs');
      expect(req.request.method).toBe('POST');
      req.flush(mock);
    });

    it('startEmbeddingBackfill sends POST /api/v1/admin/users/{id}/embedding-backfill', () => {
      const mock = { batch_id: 'b1', queued: 3, already_current: 7 };
      service.startEmbeddingBackfill('u2').subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/users/u2/embedding-backfill');
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

    it('getEmbeddingClusters sends GET /api/v1/admin/users/{id}/embedding-clusters', () => {
      const mock = { mode: 'unsupervised', discovery_mode: false, model_version: 'clip_onnx_v1', total_embeddings: 0, clusters: [] };
      service.getEmbeddingClusters('u2', 'unsupervised').subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne(r => r.url === '/api/v1/admin/users/u2/embedding-clusters');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('mode')).toBe('unsupervised');
      req.flush(mock);
    });

    it('getEmbeddingClusterPlot sends GET /api/v1/admin/users/{id}/embedding-clusters/plot', () => {
      const mock = new Blob(['png'], { type: 'image/png' });
      service.getEmbeddingClusterPlot('u2', 'label').subscribe(res => expect(res).toBe(mock));
      const req = http.expectOne(r => r.url === '/api/v1/admin/users/u2/embedding-clusters/plot');
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      expect(req.request.params.get('mode')).toBe('label');
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
      service.getLibraryClassificationMetrics('u2').subscribe(res => expect(res).toEqual(mock));
      const req = http.expectOne('/api/v1/admin/users/u2/library-classification-metrics');
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
