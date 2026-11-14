import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_READ_ONLY_MESSAGE, demoInterceptor } from './demo.interceptor';

describe('demoInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  const open = vi.fn();

  beforeEach(() => {
    open.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([demoInterceptor])),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: { open } },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('explains read-only rejections and still propagates the error', () => {
    const error = vi.fn();
    http.post('/api/v1/media', {}).subscribe({ error });
    httpMock
      .expectOne('/api/v1/media')
      .flush({ code: 'demo_read_only' }, { status: 403, statusText: 'Forbidden' });
    expect(open).toHaveBeenCalledWith(DEMO_READ_ONLY_MESSAGE, 'OK');
    expect(error).toHaveBeenCalled();
  });

  it('ignores other errors', () => {
    http.post('/api/v1/media', {}).subscribe({ error: () => {} });
    httpMock
      .expectOne('/api/v1/media')
      .flush({ code: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    expect(open).not.toHaveBeenCalled();
  });
});
