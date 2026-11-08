import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { API_BASE_URL } from '../../services/web/api.config';

interface ScanResult {
  scanned_at: string;
  added: number;
  moved: number;
  missing: number;
  changed: number;
  duplicates: string[];
}
interface MaintenanceReport {
  root: string;
  root_identity: string | null;
  checked_records: number;
  items: { id: string; path: string; missing_fields: string[]; trashed: boolean }[];
}
interface StorageStatus {
  folder_configured?: boolean;
  root: string;
  generated_dir: string;
  scan_interval_seconds: number;
  available: boolean;
  scanning: boolean;
  last_scan: ScanResult | null;
  conflicts: { id: string; path: string; status: string }[];
}

@Component({
  selector: 'zukan-storage-panel',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  template: `
    <section class="admin-card" id="storage" aria-labelledby="storage-title">
      <header class="admin-card__head">
        <div>
          <h2 id="storage-title">Storage</h2>
          <p>Where your originals live and how they are kept in sync.</p>
        </div>
        @if (status(); as s) {
          <span class="status-pill" [class.status-pill--bad]="!s.available">
            <mat-icon aria-hidden="true">{{ s.available ? 'check_circle' : 'error' }}</mat-icon>
            {{ s.available ? 'Available' : 'Unavailable — metadata retained' }}
          </span>
        }
      </header>

      @if (error()) {
        <p class="panel-alert" role="alert">{{ error() }}</p>
      }

      @if (status(); as s) {
        <div class="location">
          <mat-icon aria-hidden="true">folder</mat-icon>
          <code>{{ s.root }}</code>
        </div>

        @if (!s.folder_configured) {
          <div class="notice">
            <span>Confirm this folder as your library location.</span>
            <button
              mat-flat-button
              type="button"
              (click)="confirmFolder()"
              [disabled]="busy() || !s.available"
            >
              Use current folder
            </button>
          </div>
        }

        <div class="section">
          <h3>Settings</h3>
          <div class="settings-row">
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Generated files subfolder</mat-label>
              <input matInput [(ngModel)]="generatedDir" />
            </mat-form-field>
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Scan interval (seconds)</mat-label>
              <input matInput type="number" min="0" [(ngModel)]="scanInterval" />
              <mat-hint>0 = manual scans only</mat-hint>
            </mat-form-field>
            <button mat-stroked-button type="button" (click)="save()" [disabled]="busy()">
              Save settings
            </button>
          </div>
        </div>

        <div class="section">
          <div class="section__head">
            <div>
              <h3>Library scan</h3>
              <p>Picks up new, moved and changed files. Missing files keep their metadata.</p>
            </div>
            <button
              mat-stroked-button
              type="button"
              (click)="scan()"
              [disabled]="busy() || !s.available || s.scanning"
            >
              {{ s.scanning ? 'Scanning…' : 'Scan now' }}
            </button>
          </div>
          @if (s.last_scan; as scan) {
            <p class="muted">Last scan {{ scan.scanned_at | date: 'medium' }}</p>
            <div class="counts">
              <span><strong>{{ scan.added | number }}</strong> added</span>
              <span><strong>{{ scan.moved | number }}</strong> moved</span>
              <span><strong>{{ scan.missing | number }}</strong> missing</span>
              <span><strong>{{ scan.changed | number }}</strong> changed</span>
            </div>
            @if (scan.duplicates.length) {
              <ul class="item-list">
                @for (path of scan.duplicates; track path) {
                  <li><span>Duplicate needs review</span><code>{{ path }}</code></li>
                }
              </ul>
            }
          } @else {
            <p class="muted">No scan has run yet.</p>
          }
        </div>

        @if (s.conflicts.length) {
          <div class="section">
            <h3>Files needing attention</h3>
            <ul class="item-list">
              @for (file of s.conflicts; track file.id) {
                <li>
                  <span>{{ file.status }}</span>
                  <code>{{ file.path }}</code>
                  @if (file.status === 'changed') {
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="accept(file.id)"
                      [disabled]="busy()"
                    >
                      Accept and reprocess
                    </button>
                  }
                </li>
              }
            </ul>
          </div>
        }

        <div class="section">
          <div class="section__head">
            <div>
              <h3>Database check</h3>
              <p>Find catalog entries whose original or generated files are missing.</p>
            </div>
            <button
              mat-stroked-button
              type="button"
              (click)="inspectMaintenance()"
              [disabled]="busy() || !s.available || s.scanning"
            >
              Inspect database
            </button>
          </div>
          @if (maintenance(); as report) {
            <p class="muted">
              {{ report.checked_records | number }} records checked ·
              {{ report.items.length | number }} need attention
            </p>
            @if (report.items.length) {
              <ul class="item-list">
                @for (item of report.items; track item.id) {
                  <li>
                    <span>{{ missingLabel(item) }}</span>
                    <code>{{ item.path }}</code>
                  </li>
                }
              </ul>
              <div class="danger-zone">
                <p>
                  Cleanup permanently deletes records whose originals are missing, including their
                  annotations, and removes leftover generated files. Records that only lack a
                  thumbnail or poster are kept and marked for reprocessing.
                </p>
                <mat-checkbox [(ngModel)]="maintenanceConfirmed">
                  I accept permanent deletion of records whose originals are missing.
                </mat-checkbox>
                <button
                  mat-flat-button
                  type="button"
                  (click)="cleanupMaintenance()"
                  [disabled]="busy() || !s.available || !maintenanceConfirmed"
                >
                  Clean reviewed entries
                </button>
              </div>
            }
          }
          @if (maintenanceResult()) {
            <p class="muted" role="status">{{ maintenanceResult() }}</p>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .admin-card {
        display: grid;
        gap: 20px;
        padding: 20px;
        border-radius: 16px;
        background: var(--mat-sys-surface-container-low);
        border: 1px solid var(--mat-sys-outline-variant);
      }
      .admin-card__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      h2 {
        margin: 0;
        font-size: 1.2rem;
        font-weight: 800;
      }
      h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
      }
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .admin-card__head p,
      .section__head p,
      .muted {
        margin-top: 4px;
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.9rem;
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 12px 4px 8px;
        border-radius: 999px;
        background: var(--mat-sys-secondary-container);
        color: var(--mat-sys-on-secondary-container);
        font-size: 0.85rem;
        font-weight: 600;
      }
      .status-pill mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }
      .status-pill--bad {
        background: var(--mat-sys-error-container);
        color: var(--mat-sys-on-error-container);
      }
      .panel-alert {
        padding: 12px 16px;
        border-radius: 12px;
        background: var(--mat-sys-error-container);
        color: var(--mat-sys-on-error-container);
      }
      .location {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 12px;
        background: var(--mat-sys-surface-container);
      }
      .location mat-icon {
        color: var(--mat-sys-primary);
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.88rem;
        overflow-wrap: anywhere;
      }
      .notice {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        padding: 12px 14px;
        border-radius: 12px;
        background: var(--mat-sys-tertiary-container);
        color: var(--mat-sys-on-tertiary-container);
      }
      .section {
        display: grid;
        gap: 12px;
        padding-top: 20px;
        border-top: 1px solid var(--mat-sys-outline-variant);
      }
      .section__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }
      .section__head button {
        flex: 0 0 auto;
      }
      .settings-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        flex-wrap: wrap;
      }
      .settings-row mat-form-field {
        flex: 1 1 220px;
      }
      .settings-row button {
        margin-top: 8px;
      }
      .counts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .counts span {
        padding: 6px 12px;
        border-radius: 999px;
        background: var(--mat-sys-surface-container);
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.88rem;
      }
      .counts strong {
        color: var(--mat-sys-on-surface);
      }
      .item-list {
        display: grid;
        gap: 6px;
        max-height: 320px;
        margin: 0;
        padding: 0;
        overflow: auto;
        list-style: none;
      }
      .item-list li {
        display: grid;
        grid-template-columns: 200px minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        border-radius: 10px;
        background: var(--mat-sys-surface-container);
      }
      .item-list li > span {
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.85rem;
      }
      .item-list li > span::first-letter {
        text-transform: uppercase;
      }
      .danger-zone {
        display: grid;
        justify-items: start;
        gap: 10px;
        padding: 14px;
        border-radius: 12px;
        border: 1px solid var(--mat-sys-error);
      }
      @media (max-width: 599px) {
        .section__head {
          flex-direction: column;
        }
        .item-list li {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ],
})
export class StoragePanelComponent {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL) + '/api/v1/admin/storage';
  private readonly destroyRef = inject(DestroyRef);
  readonly status = signal<StorageStatus | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly maintenance = signal<MaintenanceReport | null>(null);
  readonly maintenanceResult = signal<string | null>(null);
  maintenanceConfirmed = false;
  generatedDir = '.zukan';
  scanInterval = 3600;

  constructor() {
    this.refresh(true);
    interval(5000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refresh());
  }
  private refresh(initial = false) {
    this.http
      .get<StorageStatus>(this.base)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.status.set(s);
          if (initial) {
            this.generatedDir = s.generated_dir;
            this.scanInterval = s.scan_interval_seconds;
          }
        },
        error: (e) => this.error.set(e.error?.detail ?? 'Unable to load storage status.'),
      });
  }
  private request(path: string, body: unknown = null, method: 'post' | 'patch' = 'post') {
    this.busy.set(true); this.error.set(null);
    this.http.request(method, this.base + path, {body}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.busy.set(false); this.refresh(); },
      error: e => { this.busy.set(false); this.error.set(typeof e.error?.detail === 'string' ? e.error.detail : 'Storage operation failed.'); },
    });
  }
  save() {
    this.request(
      '',
      { generated_dir: this.generatedDir, scan_interval_seconds: this.scanInterval },
      'patch',
    );
  }
  confirmFolder() { this.request('/confirm', {root: this.status()?.root}); }
  scan() { this.request('/scan'); }
  accept(id: string) { this.request('/conflicts/' + id + '/accept'); }
  missingLabel(item: MaintenanceReport['items'][number]): string {
    const names: Record<string, string> = {
      filepath: 'original',
      thumbnail_path: 'thumbnail',
      poster_path: 'poster',
    };
    const fields = item.missing_fields.map((field) => names[field] ?? field.replace(/_/g, ' '));
    return `Missing ${fields.join(', ')}${item.trashed ? ' · in trash' : ''}`;
  }
  inspectMaintenance() {
    this.busy.set(true); this.error.set(null); this.maintenance.set(null);
    this.maintenanceConfirmed = false; this.maintenanceResult.set(null);
    this.http.get<MaintenanceReport>(this.base + '/maintenance').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: report => { this.maintenance.set(report); this.busy.set(false); },
      error: e => { this.busy.set(false); this.error.set(e.error?.detail ?? 'Database inspection failed.'); },
    });
  }
  cleanupMaintenance() {
    const report = this.maintenance();
    if (!report || !this.maintenanceConfirmed) return;
    this.busy.set(true); this.error.set(null);
    this.http.post<{deleted_ids: string[]; repaired_ids: string[]; skipped_ids: string[]; file_cleanup_errors: {path: string; error: string}[]}>(this.base + '/maintenance/cleanup', {
      media_ids: report.items.map(item => item.id), root: report.root, root_identity: report.root_identity, confirm_permanent_deletion: true,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        this.busy.set(false); this.maintenance.set(null); this.maintenanceConfirmed = false;
        this.maintenanceResult.set(`${result.deleted_ids.length} records deleted; ${result.repaired_ids.length} generated-file references repaired; ${result.skipped_ids.length} recovered entries skipped.`);
        if (result.file_cleanup_errors.length) this.error.set('Some generated files could not be removed: ' + result.file_cleanup_errors.map(item => `${item.path}: ${item.error}`).join('; '));
        this.refresh();
      },
      error: e => { this.busy.set(false); this.error.set(e.error?.detail ?? 'Database cleanup failed.'); },
    });
  }
}
