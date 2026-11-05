import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { interval } from 'rxjs';
import { AdminTaggerStatus } from '../../models/admin';
import { AdminClientService } from '../../services/web/admin-client.service';
import { extractApiError } from '../../utils/api-error.utils';

const POLL_INTERVAL_MS = 3000;

@Component({
  selector: 'zukan-tagger-settings',
  imports: [MatButtonModule, MatFormFieldModule, MatProgressSpinnerModule, MatSelectModule],
  template: `
    <section class="tagger-settings">
      <h3>Tagger</h3>
      <p>Applies to new uploads and future retags. Existing tags stay as they are.</p>
      @if (status(); as s) {
        <p>Active: {{ activeLabel() }}{{ providerSuffix() }}</p>
        <mat-form-field>
          <mat-label>Tagger model</mat-label>
          <mat-select
            [value]="selected()"
            [disabled]="loading()"
            (selectionChange)="selected.set($event.value)"
          >
            @for (option of s.options; track option.id) {
              <mat-option [value]="option.id">{{ option.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (selectedOption(); as option) {
          <p>{{ option.description }} Download about {{ sizeInMb(option.download_size_bytes) }} MB.</p>
        }
        @if (loading()) {
          <div class="tagger-settings__status" role="status">
            <mat-progress-spinner mode="indeterminate" diameter="20"></mat-progress-spinner>
            <span>Downloading and loading…</span>
          </div>
        }
        @if (s.status === 'failed') {
          <p class="tagger-settings__error" role="alert">
            Could not switch tagger: {{ s.error }}. {{ activeLabel() }} is still active.
          </p>
        }
        <button
          mat-stroked-button
          type="button"
          [disabled]="loading() || submitting() || selected() === s.active"
          (click)="apply()"
        >
          Switch tagger
        </button>
      }
      @if (error()) {
        <p class="tagger-settings__error" role="alert">{{ error() }}</p>
      }
    </section>
  `,
  styles: `
    .tagger-settings {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
      border: 1px solid color-mix(in srgb, var(--mat-sys-outline) 65%, transparent);
      border-radius: 16px;
      background: color-mix(in srgb, var(--mat-sys-surface-container-low) 88%, white);
    }
    h3,
    p {
      margin: 0;
    }
    p {
      color: var(--mat-sys-on-surface-variant);
    }
    mat-form-field {
      width: 100%;
    }
    .tagger-settings__status {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .tagger-settings__error {
      color: var(--mat-sys-error);
    }
  `,
})
export class TaggerSettingsComponent {
  private readonly client = inject(AdminClientService);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<AdminTaggerStatus | null>(null);
  readonly selected = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly loading = computed(() => this.status()?.status === 'loading');
  readonly selectedOption = computed(() =>
    this.status()?.options.find((option) => option.id === this.selected()),
  );
  readonly activeLabel = computed(() => {
    const status = this.status();
    return status?.options.find((option) => option.id === status.active)?.label ?? status?.active;
  });

  readonly providerSuffix = computed(() => {
    const provider = this.status()?.execution_provider;
    if (!provider) return '';
    return provider.startsWith('CPU') ? ' (CPU)' : ' (GPU)';
  });

  constructor() {
    this.refresh(true);
    interval(POLL_INTERVAL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.loading()) this.refresh(false);
      });
  }

  apply(): void {
    const backend = this.selected();
    if (!backend) return;
    this.submitting.set(true);
    this.error.set(null);
    this.client
      .setTagger(backend)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          this.submitting.set(false);
          this.status.set(status);
        },
        error: (err) => {
          this.submitting.set(false);
          this.error.set(extractApiError(err));
        },
      });
  }

  sizeInMb(bytes: number): number {
    return Math.round(bytes / 1_000_000);
  }

  private refresh(initial: boolean): void {
    const select = initial || this.loading();
    this.client
      .getTagger()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          this.status.set(status);
          if (select) this.selected.set(status.target ?? status.active);
          this.error.set(null);
        },
        error: (err) => this.error.set(extractApiError(err)),
      });
  }
}
