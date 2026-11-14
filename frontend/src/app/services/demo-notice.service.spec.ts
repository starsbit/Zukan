import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoModeService } from './demo-mode.service';
import { DemoNoticeService } from './demo-notice.service';
import { SESSION_STORAGE } from './web/auth.store';

describe('DemoNoticeService', () => {
  let storage: Map<string, string>;
  let closed: Subject<void>;
  let open: ReturnType<typeof vi.fn>;

  function setup(initial: Record<string, string> = {}) {
    storage = new Map(Object.entries(initial));
    closed = new Subject<void>();
    open = vi.fn(() => ({ afterClosed: () => closed }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MatDialog, useValue: { open } },
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
    const service = TestBed.inject(DemoNoticeService);
    TestBed.tick();
    return { service, demo: TestBed.inject(DemoModeService) };
  }

  beforeEach(() => vi.clearAllMocks());

  it('stays closed outside demo mode', () => {
    setup();
    expect(open).not.toHaveBeenCalled();
  });

  it('opens once per session when demo mode turns on', () => {
    const { demo } = setup();
    demo.set(true);
    TestBed.tick();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][1]).toMatchObject({ closeOnNavigation: false });
    expect(storage.get('zukan_demo_notice_seen')).toBe('1');
    closed.next();
    demo.set(false);
    demo.set(true);
    TestBed.tick();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does not reopen after a reload in the same session', () => {
    setup({ zukan_demo: '1', zukan_demo_notice_seen: '1' });
    expect(open).not.toHaveBeenCalled();
  });

  it('can be reopened manually but not stacked', () => {
    const { service } = setup({ zukan_demo: '1', zukan_demo_notice_seen: '1' });
    service.show();
    service.show();
    expect(open).toHaveBeenCalledTimes(1);
    closed.next();
    service.show();
    expect(open).toHaveBeenCalledTimes(2);
  });
});
