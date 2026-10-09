import { Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { API_BASE_URL } from '../../services/web/api.config';
import { AdminClientService } from '../../services/web/admin-client.service';

interface Migration {
  id: string; state: string; error: string | null;
  source_root: string; destination_root: string;
  total_files: number; copied_files: number; cleaned_files: number;
}
interface ScanResult {
  scanned_at: string; added: number; moved: number; missing: number; changed: number; duplicates: string[];
}
interface MaintenanceReport {
  root: string; root_identity: string | null; checked_records: number;
  items: { id: string; path: string; missing_fields: string[]; trashed: boolean }[];
}
interface StorageStatus {
  folder_configured?: boolean; root: string; generated_dir: string; discovery_owner_id: string | null;
  scan_interval_seconds: number; available: boolean; scanning: boolean;
  last_scan: ScanResult | null; migration: Migration | null;
  conflicts: { id: string; path: string; status: string }[];
}

@Component({
  selector: 'zukan-storage-panel',
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule],
  template: `
    <mat-card id="storage">
      <mat-card-header><mat-card-title>Storage</mat-card-title></mat-card-header>
      <mat-card-content>
        @if (error()) { <p role="alert">{{ error() }}</p> }
        @if (status(); as s) {
          @if (!s.folder_configured) {
            <p>Confirm your current folder or move your library to another folder below.</p>
            <button mat-stroked-button (click)="confirmFolder()" [disabled]="busy() || migrating() || !s.available">Use current folder</button>
          }
          <p><strong>{{ s.available ? 'Available' : 'Unavailable — metadata retained' }}</strong>: {{ s.root }}</p>
          <p>PostgreSQL remains in its current location. Mount the NAS folder in the API container before selecting it.</p>
          <div class="fields">
            <mat-form-field><mat-label>Generated files subfolder</mat-label><input matInput [(ngModel)]="generatedDir"></mat-form-field>
            <mat-form-field><mat-label>Discovery owner</mat-label>
              <mat-select [(ngModel)]="ownerId"><mat-option [value]="null">Disable discovery</mat-option>
                @for (user of users(); track user.id) { <mat-option [value]="user.id">{{ user.username }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <mat-form-field><mat-label>Scan interval (seconds; 0 = manual)</mat-label><input matInput type="number" min="0" [(ngModel)]="scanInterval"></mat-form-field>
          </div>
          <p>Discovered files remain in place and start private. Missing and changed files retain their metadata.</p>
          <button mat-stroked-button (click)="save()" [disabled]="busy() || migrating()">Save settings</button>
          <button mat-stroked-button (click)="scan()" [disabled]="busy() || migrating() || !s.available || !ownerId || s.scanning">{{ s.scanning ? 'Scanning…' : 'Scan now' }}</button>
          @if (s.last_scan; as scan) {
            <p>Last scan: {{ scan.scanned_at }} — {{ scan.added }} added, {{ scan.moved }} moved, {{ scan.missing }} missing, {{ scan.changed }} changed.</p>
            @for (path of scan.duplicates; track path) { <p>Duplicate requiring review: {{ path }}</p> }
          }
          <h3>Database maintenance</h3>
          <p>Inspect catalog references for missing originals and generated files. Unavailable storage stops the check.</p>
          <button mat-stroked-button (click)="inspectMaintenance()" [disabled]="busy() || migrating() || !s.available || s.scanning">Inspect database</button>
          @if (maintenance(); as report) {
            <p>{{ report.checked_records }} records checked; {{ report.items.length }} need attention.</p>
            @for (item of report.items; track item.id) {
              <p>{{ item.path }} — missing {{ item.missing_fields.join(', ') }}{{ item.trashed ? ' (in trash)' : '' }}</p>
            }
            @if (report.items.length) {
              <p>Cleanup permanently deletes records with missing originals, including their annotations and relationships, and removes their remaining generated files. Collection compensation and trade cleanup follow normal permanent deletion. Records with only missing thumbnails or posters keep their metadata; broken generated-file references are cleared and marked failed for reprocessing.</p>
              <mat-checkbox [(ngModel)]="maintenanceConfirmed">I accept permanent deletion of records whose originals are missing.</mat-checkbox>
              <button mat-flat-button (click)="cleanupMaintenance()" [disabled]="busy() || migrating() || !s.available || !maintenanceConfirmed">Clean reviewed entries</button>
            }
          }
          @if (maintenanceResult()) { <p role="status">{{ maintenanceResult() }}</p> }
          <h3>Move library</h3>
          <mat-form-field class="destination"><mat-label>Destination folder (absolute path in API container)</mat-label><input matInput [(ngModel)]="destination" (ngModelChange)="validation.set(null)"></mat-form-field>
          <p>Files will be copied and verified before switching. Verified old copies will then be deleted; unrelated files remain.</p>
          <button mat-stroked-button (click)="validate()" [disabled]="busy() || migrating() || !destination">Validate destination</button>
          @if (validation(); as v) { <p>{{ v.total_files }} files; {{ v.required_bytes }} bytes to copy.</p> }
          <button mat-flat-button (click)="migrate()" [disabled]="busy() || migrating() || !validation()">Copy, verify and migrate</button>
          @if (s.migration; as job) {
            <p role="status">Migration: {{ job.state }} — {{ job.copied_files }}/{{ job.total_files }} copied; {{ job.cleaned_files }}/{{ job.total_files }} old copies removed.</p>
            @if (job.error) { <p role="alert">{{ job.error }}</p> }
            @if (job.state === 'failed' || job.state === 'cleanup_pending') {
              <button mat-stroked-button (click)="resume(job.id)" [disabled]="busy()">Resume migration</button>
            }
          }
          @if (s.conflicts.length) { <h3>Files needing attention</h3> }
          @for (file of s.conflicts; track file.id) {
            <p>{{ file.path }} — {{ file.status }}
              @if (file.status === 'changed') { <button mat-stroked-button (click)="accept(file.id)" [disabled]="busy() || migrating()">Accept changed content and reprocess</button> }
            </p>
          }
        }
      </mat-card-content>
    </mat-card>
  `,
  styles: [`mat-card { margin: 24px 0; } mat-card-content { padding-top: 16px; } .fields { display: flex; gap: 16px; flex-wrap: wrap; } .destination { width: 100%; } button { margin: 0 8px 8px 0; } p { overflow-wrap: anywhere; }`],
})
export class StoragePanelComponent {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL) + '/api/v1/admin/storage';
  private readonly admin = inject(AdminClientService);
  private readonly destroyRef = inject(DestroyRef);
  readonly status = signal<StorageStatus | null>(null);
  readonly users = signal<{id: string; username: string}[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly validation = signal<{total_files: number; required_bytes: number} | null>(null);
  readonly maintenance = signal<MaintenanceReport | null>(null);
  readonly maintenanceResult = signal<string | null>(null);
  maintenanceConfirmed = false;
  generatedDir = '.zukan';
  ownerId: string | null = null;
  scanInterval = 3600;
  destination = '';

  constructor() {
    this.refresh(true);
    this.loadUsers(1);
    interval(5000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
  }
  private loadUsers(page: number) {
    this.admin.listUsers({page, page_size: 200}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        this.users.update(users => [...users, ...result.items]);
        if (page * 200 < result.total) this.loadUsers(page + 1);
      }, error: () => this.error.set('Unable to load discovery owners.'),
    });
  }
  migrating() { return ['copying', 'verifying', 'cleanup'].includes(this.status()?.migration?.state ?? ''); }
  private refresh(initial = false) {
    this.http.get<StorageStatus>(this.base).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => {
        this.status.set(s);
        if (initial) { this.generatedDir = s.generated_dir; this.ownerId = s.discovery_owner_id; this.scanInterval = s.scan_interval_seconds; }
      }, error: e => this.error.set(e.error?.detail ?? 'Unable to load storage status.'),
    });
  }
  private request(path: string, body: unknown = null, method: 'post' | 'patch' = 'post') {
    this.busy.set(true); this.error.set(null);
    this.http.request(method, this.base + path, {body}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.busy.set(false); this.refresh(); },
      error: e => { this.busy.set(false); this.error.set(typeof e.error?.detail === 'string' ? e.error.detail : 'Storage operation failed.'); },
    });
  }
  save() { this.validation.set(null); this.request('', {generated_dir: this.generatedDir, discovery_owner_id: this.ownerId, scan_interval_seconds: this.scanInterval}, 'patch'); }
  confirmFolder() { this.request('/confirm', {root: this.status()?.root}); }
  scan() { this.request('/scan'); }
  migrate() { this.request('/migrations', {root: this.destination}); this.validation.set(null); }
  resume(id: string) { this.request('/migrations/' + id + '/resume'); }
  accept(id: string) { this.request('/conflicts/' + id + '/accept'); }
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
    this.busy.set(true); this.error.set(null); this.validation.set(null);
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
  validate() {
    this.busy.set(true); this.error.set(null); this.validation.set(null);
    this.http.post<{total_files: number; required_bytes: number}>(this.base + '/validate', {root: this.destination}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: v => { this.validation.set(v); this.busy.set(false); },
      error: e => { this.busy.set(false); this.error.set(e.error?.detail ?? 'Destination validation failed.'); },
    });
  }
}
