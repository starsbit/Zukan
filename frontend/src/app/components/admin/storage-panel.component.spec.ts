import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, afterEach } from 'vitest';
import { StoragePanelComponent } from './storage-panel.component';
import { API_BASE_URL } from '../../services/web/api.config';

const status = {root: '/library', generated_dir: '.zukan', discovery_owner_id: 'u1', scan_interval_seconds: 3600,
  available: true, scanning: false, last_scan: null, migration: null, conflicts: []};

describe('StoragePanelComponent', () => {
  let http: HttpTestingController;
  function create() {
    TestBed.configureTestingModule({imports: [StoragePanelComponent], providers: [provideHttpClient(), provideHttpClientTesting(), {provide: API_BASE_URL, useValue: ''}]});
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StoragePanelComponent);
    http.expectOne('/api/v1/admin/storage').flush(status);
    http.expectOne(r => r.url.endsWith('/admin/users')).flush({items: [{id: 'u1', username: 'admin'}], total: 1});
    fixture.detectChanges();
    return fixture;
  }
  afterEach(() => { http.verify(); });
  it('loads persistent settings and shows unavailable metadata retention', () => {
    const fixture = create();
    expect(fixture.componentInstance.ownerId).toBe('u1');
    fixture.componentInstance.status.set({...status, available: false}); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('metadata retained');
    fixture.destroy();
  });
  it('validates before migration and shows server conflicts', () => {
    const fixture = create(); const c = fixture.componentInstance;
    c.destination = '/nas'; c.validate();
    http.expectOne('/api/v1/admin/storage/validate').flush({detail: 'Destination contains different content'}, {status: 409, statusText: 'Conflict'});
    expect(c.validation()).toBeNull(); expect(c.error()).toContain('different content');
    c.validate(); http.expectOne('/api/v1/admin/storage/validate').flush({total_files: 3, required_bytes: 1024});
    c.migrate();
    const request = http.expectOne('/api/v1/admin/storage/migrations');
    expect(request.request.body).toEqual({root: '/nas'}); request.flush({id: 'job'});
    http.expectOne('/api/v1/admin/storage').flush(status); fixture.destroy();
  });
  it('saves the discovery owner and scan interval without patching the root', () => {
    const fixture = create(); const c = fixture.componentInstance;
    c.scanInterval = 0; c.save();
    const request = http.expectOne('/api/v1/admin/storage');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({generated_dir: '.zukan', discovery_owner_id: 'u1', scan_interval_seconds: 0});
    request.flush(status); http.expectOne('/api/v1/admin/storage').flush(status); fixture.destroy();
  });
});
