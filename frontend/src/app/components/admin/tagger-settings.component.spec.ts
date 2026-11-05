import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminTaggerStatus } from '../../models/admin';
import { AdminClientService } from '../../services/web/admin-client.service';
import { TaggerSettingsComponent } from './tagger-settings.component';

const ready: AdminTaggerStatus = {
  active: 'wd_v3',
  status: 'ready',
  target: null,
  error: null,
  execution_provider: 'CPUExecutionProvider',
  options: [
    { id: 'wd_v3', label: 'WD ViT Tagger v3', description: 'Default.', download_size_bytes: 380000000 },
    {
      id: 'pixai_v1_336_int8',
      label: 'PixAI v1.0 336px INT8',
      description: 'Community fine-tune.',
      download_size_bytes: 494000000,
    },
  ],
};
const loading: AdminTaggerStatus = { ...ready, status: 'loading', target: 'pixai_v1_336_int8' };

describe('TaggerSettingsComponent', () => {
  let client: { getTagger: ReturnType<typeof vi.fn>; setTagger: ReturnType<typeof vi.fn> };

  function create() {
    TestBed.configureTestingModule({
      imports: [TaggerSettingsComponent, NoopAnimationsModule],
      providers: [{ provide: AdminClientService, useValue: client }],
    });
    const fixture = TestBed.createComponent(TaggerSettingsComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    client = { getTagger: vi.fn().mockReturnValue(of(ready)), setTagger: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the active tagger and keeps switching disabled until another is chosen', () => {
    const fixture = create();
    const button = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(fixture.componentInstance.selected()).toBe('wd_v3');
    expect(button().disabled).toBe(true);

    fixture.componentInstance.selected.set('pixai_v1_336_int8');
    fixture.detectChanges();

    expect(button().disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Community fine-tune.');
    expect(fixture.nativeElement.textContent).toContain('494 MB');
    expect(fixture.nativeElement.textContent).toContain('Existing tags stay as they are');
  });

  it('switches, polls while loading, and stops once ready', () => {
    client.setTagger.mockReturnValue(of(loading));
    const fixture = create();
    fixture.componentInstance.selected.set('pixai_v1_336_int8');

    fixture.componentInstance.apply();
    fixture.detectChanges();

    expect(client.setTagger).toHaveBeenCalledWith('pixai_v1_336_int8');
    expect(fixture.nativeElement.textContent).toContain('Downloading and loading');

    client.getTagger.mockReturnValue(of({ ...ready, active: 'pixai_v1_336_int8' }));
    client.getTagger.mockClear();
    vi.advanceTimersByTime(3000);
    fixture.detectChanges();

    expect(client.getTagger).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.status()?.active).toBe('pixai_v1_336_int8');
    expect(fixture.componentInstance.selected()).toBe('pixai_v1_336_int8');
    expect(fixture.nativeElement.textContent).not.toContain('Downloading and loading');

    vi.advanceTimersByTime(9000);
    expect(client.getTagger).toHaveBeenCalledTimes(1);
  });

  it('resumes a running switch when reopened', () => {
    client.getTagger.mockReturnValue(of(loading));
    const fixture = create();

    expect(fixture.componentInstance.selected()).toBe('pixai_v1_336_int8');
    expect(fixture.nativeElement.textContent).toContain('Downloading and loading');
  });

  it('shows a failed switch and that the previous tagger is still active', () => {
    client.getTagger.mockReturnValue(of(loading));
    const fixture = create();

    client.getTagger.mockReturnValue(of({ ...ready, status: 'failed', error: 'no network' }));
    vi.advanceTimersByTime(3000);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('no network');
    expect(fixture.nativeElement.textContent).toContain('WD ViT Tagger v3 is still active');
    expect(fixture.componentInstance.selected()).toBe('wd_v3');
  });

  it('shows an error when the request is rejected', () => {
    client.setTagger.mockReturnValue(throwError(() => new Error('nope')));
    const fixture = create();
    fixture.componentInstance.selected.set('pixai_v1_336_int8');

    fixture.componentInstance.apply();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.componentInstance.submitting()).toBe(false);
  });

  it('does not offer a retag', () => {
    const fixture = create();

    expect(fixture.nativeElement.textContent).not.toContain('Retag');
  });
});
