import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect } from 'vitest';
import { AdminDashboardPageComponent } from './admin-dashboard-page.component';

describe('Library maintenance', () => {
  it('offers library operations without user management', async () => {
    await TestBed.configureTestingModule({
      imports: [AdminDashboardPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminDashboardPageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Backfill embeddings');
    expect(fixture.nativeElement.textContent).not.toContain('Manage users');
    fixture.destroy();
  });
});
