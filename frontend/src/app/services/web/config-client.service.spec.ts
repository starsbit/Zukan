import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigClientService } from './config-client.service';
import { API_BASE_URL } from './api.config';

describe('ConfigClientService', () => {
  let service: ConfigClientService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '' },
      ],
    });
    service = TestBed.inject(ConfigClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('getSetupRequired sends GET /api/v1/config/setup-required', () => {
    service.getSetupRequired().subscribe(res => expect(res).toEqual({ setup_required: true }));

    const req = http.expectOne('/api/v1/config/setup-required');
    expect(req.request.method).toBe('GET');
    req.flush({ setup_required: true });
  });

  it('getSetupRequired returns false when setup is complete', () => {
    service.getSetupRequired().subscribe(res => expect(res.setup_required).toBe(false));

    const req = http.expectOne('/api/v1/config/setup-required');
    req.flush({ setup_required: false });
  });

  it('getUploadConfig sends GET /api/v1/config/upload', () => {
    service.getUploadConfig().subscribe(res => expect(res).toEqual({ max_batch_size: 1000 }));

    const req = http.expectOne('/api/v1/config/upload');
    expect(req.request.method).toBe('GET');
    req.flush({ max_batch_size: 1000 });
  });
});
