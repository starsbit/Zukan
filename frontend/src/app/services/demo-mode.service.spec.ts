import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoModeService } from './demo-mode.service';
import { SESSION_STORAGE } from './web/auth.store';

describe('DemoModeService', () => {
  let storage: Map<string, string>;

  function create(): DemoModeService {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SESSION_STORAGE,
          useValue: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
          },
        },
      ],
    });
    return TestBed.inject(DemoModeService);
  }

  beforeEach(() => {
    storage = new Map();
    TestBed.resetTestingModule();
  });

  it('is disabled by default', () => {
    expect(create().enabled()).toBe(false);
  });

  it('persists the flag for the browser session', () => {
    create().set(true);
    expect(storage.get('zukan_demo')).toBe('1');
    TestBed.resetTestingModule();
    expect(create().enabled()).toBe(true);
  });

  it('clears the flag', () => {
    storage.set('zukan_demo', '1');
    const service = create();
    service.set(false);
    expect(service.enabled()).toBe(false);
    expect(storage.has('zukan_demo')).toBe(false);
  });

  it('remembers the notice for the browser session', () => {
    const service = create();
    expect(service.noticeSeen()).toBe(false);
    service.markNoticeSeen();
    expect(service.noticeSeen()).toBe(true);
    TestBed.resetTestingModule();
    expect(create().noticeSeen()).toBe(true);
  });
});
