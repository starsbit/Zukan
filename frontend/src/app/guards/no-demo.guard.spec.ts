import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { noDemoGuard } from './no-demo.guard';
import { DemoModeService } from '../services/demo-mode.service';

describe('noDemoGuard', () => {
  function run(enabled: boolean, parseUrl = vi.fn()) {
    TestBed.configureTestingModule({
      providers: [
        { provide: DemoModeService, useValue: { enabled: () => enabled } },
        { provide: Router, useValue: { parseUrl } },
      ],
    });
    return TestBed.runInInjectionContext(() => noDemoGuard({} as never, {} as never));
  }

  it('allows access outside demo mode', () => {
    expect(run(false)).toBe(true);
  });

  it('redirects to home in demo mode', () => {
    const redirect = { redirectedTo: '/' };
    const parseUrl = vi.fn(() => redirect);

    expect(run(true, parseUrl)).toBe(redirect);
    expect(parseUrl).toHaveBeenCalledWith('/');
  });
});
