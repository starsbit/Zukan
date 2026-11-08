import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, afterEach } from 'vitest';
import { StoragePanelComponent } from './storage-panel.component';
import { API_BASE_URL } from '../../services/web/api.config';

const status = {
  root: '/library',
  generated_dir: '.zukan',
  scan_interval_seconds: 3600,
  available: true,
  scanning: false,
  last_scan: null,
  conflicts: [],
};

describe('StoragePanelComponent', () => {
  let http: HttpTestingController;
  function create() {
    TestBed.configureTestingModule({
      imports: [StoragePanelComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StoragePanelComponent);
    http.expectOne('/api/v1/admin/storage').flush(status);
    fixture.detectChanges();
    return fixture;
  }
  afterEach(() => {
    http.verify();
  });
  it('loads persistent settings and shows unavailable metadata retention', () => {
    const fixture = create();
    fixture.componentInstance.status.set({ ...status, available: false });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('metadata retained');
    fixture.destroy();
  });
  it('shows the library location without migration controls', () => {
    const fixture = create();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('/library');
    expect(text).toContain('Scan now');
    expect(text).not.toContain('Move library');
    expect(text).not.toContain('Validate destination');
    fixture.destroy();
  });
  it('requires acknowledgment and sends only the reviewed maintenance IDs', () => {
    const fixture = create(); const c = fixture.componentInstance;
    c.inspectMaintenance();
    http.expectOne('/api/v1/admin/storage/maintenance').flush({root: '/library', root_identity: 'marker', checked_records: 100,
      items: [{id: 'missing', path: 'lost.jpg', missing_fields: ['filepath'], trashed: false}]});
    c.cleanupMaintenance();
    http.expectNone('/api/v1/admin/storage/maintenance/cleanup');
    c.maintenanceConfirmed = true; c.cleanupMaintenance();
    const request = http.expectOne('/api/v1/admin/storage/maintenance/cleanup');
    expect(request.request.body).toEqual({media_ids: ['missing'], root: '/library', root_identity: 'marker', confirm_permanent_deletion: true});
    request.flush({deleted_ids: ['missing'], repaired_ids: [], skipped_ids: [], file_cleanup_errors: []});
    http.expectOne('/api/v1/admin/storage').flush(status);
    expect(c.maintenanceResult()).toContain('1 records deleted');
    expect(c.maintenance()).toBeNull(); fixture.destroy();
  });
});
