import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { StorageSetupService } from './storage-setup.service';
import { UserStore } from './user.store';
import { API_BASE_URL } from './web/api.config';

const admin = {id: 'admin-id', is_admin: true};
describe('StorageSetupService', () => {
  function setup(user: typeof admin | null = admin, url = '/gallery') {
    const currentUser = signal(user);
    const events = new Subject<NavigationEnd>();
    const closed = new Subject<string>();
    const close = vi.fn();
    const open = vi.fn(() => ({afterClosed: () => closed, close}));
    const navigate = vi.fn();
    TestBed.configureTestingModule({providers: [provideHttpClient(), provideHttpClientTesting(),
      {provide: UserStore, useValue: {currentUser}}, {provide: API_BASE_URL, useValue: ''},
      {provide: MatDialog, useValue: {open}}, {provide: Router, useValue: {url, events, navigate}},
    ]});
    TestBed.inject(StorageSetupService); TestBed.tick();
    return {http: TestBed.inject(HttpTestingController), currentUser, events, closed, open, close, navigate};
  }
  it('prompts an admin once and links directly to storage settings', () => {
    const s = setup(); s.http.expectOne('/api/v1/admin/storage').flush({root: '/library', folder_configured: false, migration: null});
    expect(s.open).toHaveBeenCalledOnce();
    s.closed.next('settings');
    expect(s.navigate).toHaveBeenCalledWith(['/admin'], {fragment: 'storage'});
    s.events.next(new NavigationEnd(1, '/browse', '/browse')); TestBed.tick();
    s.http.expectNone('/api/v1/admin/storage'); s.http.verify();
  });
  it('does not prompt users without admin access or interrupt initial credential setup', () => {
    const s = setup({...admin, is_admin: false}); s.http.expectNone('/api/v1/admin/storage');
    s.currentUser.set(admin); s.events.next(new NavigationEnd(1, '/login', '/login')); TestBed.tick();
    s.http.expectNone('/api/v1/admin/storage');
    s.events.next(new NavigationEnd(2, '/gallery', '/gallery')); TestBed.tick();
    s.http.expectOne('/api/v1/admin/storage').flush({root: '/library', folder_configured: false, migration: null});
    expect(s.open).toHaveBeenCalledOnce(); s.http.verify();
  });
  it('does not prompt once a folder has been confirmed', () => {
    const s = setup(); s.http.expectOne('/api/v1/admin/storage').flush({root: '/library', folder_configured: true, migration: null});
    expect(s.open).not.toHaveBeenCalled(); s.http.verify();
  });
  it('defers during migration and checks again after a fresh login', () => {
    const s = setup(); s.http.expectOne('/api/v1/admin/storage').flush({root: '/library', folder_configured: false, migration: {state: 'copying'}});
    expect(s.open).not.toHaveBeenCalled();
    s.currentUser.set(null); TestBed.tick(); s.currentUser.set(admin); TestBed.tick();
    s.http.expectOne('/api/v1/admin/storage').flush({root: '/library', folder_configured: false, migration: null});
    expect(s.open).toHaveBeenCalledOnce(); s.http.verify();
  });
});
