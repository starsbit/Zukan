import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUpdateService } from './app-update.service';
import { API_BASE_URL } from './web/api.config';

function setup(getResponse: () => Observable<unknown>) {
  const http = {
    get: vi.fn(() => getResponse()),
  };

  TestBed.configureTestingModule({
    providers: [
      AppUpdateService,
      { provide: HttpClient, useValue: http },
      { provide: API_BASE_URL, useValue: '' },
    ],
  });

  return {
    service: TestBed.inject(AppUpdateService),
    http,
  };
}

describe('AppUpdateService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('starts in idle state', () => {
    const { service } = setup(() => of(null));
    expect(service.status()).toBe('idle');
  });

  it('transitions to updating immediately when startUpdate is called', () => {
    const { service } = setup(() => of(null));
    service.startUpdate();
    expect(service.status()).toBe('updating');
  });

  it('stays in updating while health checks succeed before server was ever down', () => {
    const { service } = setup(() => of({ status: 200 }));
    service.startUpdate();

    vi.advanceTimersByTime(3000);
    expect(service.status()).toBe('updating');

    vi.advanceTimersByTime(3000);
    expect(service.status()).toBe('updating');
  });

  it('transitions to restarting when the health endpoint fails', () => {
    const { service } = setup(() => throwError(() => new Error('network error')));
    service.startUpdate();

    vi.advanceTimersByTime(3000);
    expect(service.status()).toBe('restarting');
  });

  it('transitions from restarting to done when health comes back up', () => {
    let callCount = 0;
    const { service } = setup(() => {
      callCount++;
      return callCount === 1
        ? throwError(() => new Error('network error'))
        : of({ status: 200 });
    });

    service.startUpdate();

    vi.advanceTimersByTime(3000);
    expect(service.status()).toBe('restarting');

    vi.advanceTimersByTime(3000);
    expect(service.status()).toBe('done');
  });

  it('stops polling after reaching done', () => {
    let callCount = 0;
    const { service, http } = setup(() => {
      callCount++;
      return callCount === 1
        ? throwError(() => new Error('network error'))
        : of({ status: 200 });
    });

    service.startUpdate();
    vi.advanceTimersByTime(3000);
    vi.advanceTimersByTime(3000);

    expect(service.status()).toBe('done');
    const callsAtDone = http.get.mock.calls.length;

    vi.advanceTimersByTime(9000);
    expect(http.get.mock.calls.length).toBe(callsAtDone);
  });

  it('dismiss resets to idle and stops polling', () => {
    const { service, http } = setup(() => of({ status: 200 }));
    service.startUpdate();
    service.dismiss();

    expect(service.status()).toBe('idle');

    const callsBefore = http.get.mock.calls.length;
    vi.advanceTimersByTime(9000);
    expect(http.get.mock.calls.length).toBe(callsBefore);
  });

  it('calling startUpdate again resets serverWasDown and restarts as updating', () => {
    let callCount = 0;
    const { service } = setup(() => {
      callCount++;
      return callCount === 1
        ? throwError(() => new Error('network error'))
        : of({ status: 200 });
    });

    service.startUpdate();
    vi.advanceTimersByTime(3000);
    expect(service.status()).toBe('restarting');

    service.startUpdate();
    expect(service.status()).toBe('updating');

    vi.advanceTimersByTime(3000);
    expect(service.status()).toBe('updating');
  });
});