import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, expect, it, vi } from 'vitest';
import { UpdateStatusIslandComponent } from './update-status-island.component';
import { AppUpdateService, UpdateStatus } from '../../../services/app-update.service';
import { UserStore } from '../../../services/user.store';

function createFixture(status: UpdateStatus, isAdmin: boolean) {
  const updateService = {
    status: signal<UpdateStatus>(status),
    dismiss: vi.fn(),
  };
  const userStore = { isAdmin: signal(isAdmin) };

  TestBed.configureTestingModule({
    imports: [UpdateStatusIslandComponent, NoopAnimationsModule],
    providers: [
      { provide: AppUpdateService, useValue: updateService },
      { provide: UserStore, useValue: userStore },
    ],
  });

  const fixture = TestBed.createComponent(UpdateStatusIslandComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, updateService };
}

describe('UpdateStatusIslandComponent', () => {
  it('renders nothing when status is idle', () => {
    const { el } = createFixture('idle', true);
    expect(el.textContent?.trim()).toBe('');
  });

  it('renders nothing for non-admin users even when updating', () => {
    const { el } = createFixture('updating', false);
    expect(el.textContent?.trim()).toBe('');
  });

  it('shows updating title and subtitle with a progress bar', () => {
    const { el } = createFixture('updating', true);
    expect(el.textContent).toContain('Update in progress');
    expect(el.textContent).toContain('Pulling latest changes');
    expect(el.querySelector('mat-progress-bar')).not.toBeNull();
  });

  it('shows restarting title and subtitle with a progress bar', () => {
    const { el } = createFixture('restarting', true);
    expect(el.textContent).toContain('Zukan is restarting');
    expect(el.textContent).toContain('Server restarting');
    expect(el.querySelector('mat-progress-bar')).not.toBeNull();
  });

  it('shows done state without a progress bar', () => {
    const { el } = createFixture('done', true);
    expect(el.textContent).toContain('Update complete');
    expect(el.querySelector('mat-progress-bar')).toBeNull();
  });

  it('shows Refresh page and Dismiss buttons in done state', () => {
    const { el } = createFixture('done', true);
    const buttonLabels = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(buttonLabels).toContain('Dismiss');
    expect(buttonLabels.some((t) => t?.includes('Refresh page'))).toBe(true);
  });

  it('does not show action buttons in updating state', () => {
    const { el } = createFixture('updating', true);
    const buttons = el.querySelectorAll('mat-card-actions button');
    expect(buttons.length).toBe(0);
  });

  it('calls dismiss() when dismiss button is clicked', () => {
    const { el, updateService } = createFixture('done', true);
    const dismissBtn = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Dismiss',
    ) as HTMLButtonElement;
    dismissBtn.click();
    expect(updateService.dismiss).toHaveBeenCalledTimes(1);
  });
});
