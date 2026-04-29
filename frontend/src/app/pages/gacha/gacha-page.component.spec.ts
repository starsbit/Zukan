import '@angular/compiler';
import { Component, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabGroup, MatTabsModule } from '@angular/material/tabs';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { CollectionItemRead } from '../../models/collection';
import { GachaPullMode, RarityTier } from '../../models/gacha';
import { MediaService } from '../../services/media.service';
import { UserStore } from '../../services/user.store';
import { CollectionClientService } from '../../services/web/collection-client.service';
import { GachaClientService } from '../../services/web/gacha-client.service';
import { GachaDisplayCardComponent } from './gacha-display-card/gacha-display-card.component';
import { GachaPageComponent } from './gacha-page.component';

@Component({
  selector: 'zukan-layout',
  standalone: true,
  template: '<ng-content></ng-content>',
})
class StubLayoutComponent {}

const collectionItem: CollectionItemRead = {
  id: 'ci1',
  user_id: 'u1',
  media_id: 'm1',
  rarity_tier_at_acquisition: RarityTier.SR,
  level: 2,
  upgrade_xp: 4,
  copies_pulled: 3,
  locked: true,
  tradeable: true,
  acquired_at: '2026-04-28T00:00:00Z',
  updated_at: '2026-04-28T00:00:00Z',
  media: { id: 'm1', filename: 'saber.webp', is_nsfw: false, is_sensitive: false },
};

describe('GachaPageComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  async function createComponent(options: {
    balance?: number;
    dailyAvailable?: boolean;
    collectionItems?: CollectionItemRead[];
    pullError?: unknown;
    showNsfw?: boolean;
    showSensitive?: boolean;
  } = {}) {
    const balance = options.balance ?? 10;
    const dailyAvailable = options.dailyAvailable ?? true;
    let currentBalance = balance;
    let currentDailyAvailable = dailyAvailable;
    const collectionItems = options.collectionItems ?? [collectionItem];
    const pullResponse = {
      id: 'p1',
      user_id: 'u1',
      mode: GachaPullMode.TEN_PULL,
      pool: null,
      currency_spent: 9,
      currency_balance: Math.max(balance - 9, 0),
      created_at: '2026-04-28T00:00:00Z',
      items: [
        {
          id: 'pi1',
          media_id: 'm1',
          rarity_tier: RarityTier.UR,
          rarity_score: 0.99,
          was_duplicate: false,
          upgrade_material_granted: 0,
          position: 0,
          collection_item_id: 'ci1',
        },
      ],
    };
    const gachaClient = {
      getBalance: vi.fn(() => of({
        user_id: 'u1',
        balance: currentBalance,
        total_claimed: 10,
        total_spent: 0,
        last_daily_claimed_on: currentDailyAvailable ? null : '2026-04-28',
        daily_claim_amount: 10,
        daily_claim_available: currentDailyAvailable,
        next_daily_claim_at: currentDailyAvailable ? null : '2026-04-29T00:00:00Z',
      })),
      getStats: vi.fn(() => of({
        total_rarity_snapshots: 5,
        tier_counts: { N: 2, R: 1, SR: 1, SSR: 0, UR: 1 },
        collection_count: collectionItems.length,
        duplicate_copies: 2,
        currency_balance: currentBalance,
        daily_claim_available: currentDailyAvailable,
        next_daily_claim_at: currentDailyAvailable ? null : '2026-04-29T00:00:00Z',
      })),
      claimDaily: vi.fn(() => {
        currentBalance += 10;
        currentDailyAvailable = false;
        return of({
          claimed: 10,
          balance: currentBalance,
          daily_claim_available: false,
          next_daily_claim_at: '2026-04-29T00:00:00Z',
        });
      }),
      pull: vi.fn(() => options.pullError ? throwError(() => options.pullError) : of(pullResponse)),
    };
    const collectionClient = {
      list: vi.fn(() => of({ total: collectionItems.length, items: collectionItems })),
    };
    const mediaService = {
      getThumbnailUrl: vi.fn((id: string) => of(`blob:${id}`)),
    };
    const currentUser = signal({
      id: 'u1',
      username: 'alice',
      email: 'alice@example.com',
      is_admin: false,
      show_nsfw: options.showNsfw ?? true,
      show_sensitive: options.showSensitive ?? true,
      tag_confidence_threshold: 0.35,
      version: 1,
      created_at: '2026-04-28T00:00:00Z',
      storage_quota_mb: 1024,
      storage_used_mb: 0,
    });
    const userStore = { currentUser };
    const snackBar = { open: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [GachaPageComponent, NoopAnimationsModule],
      providers: [
        { provide: GachaClientService, useValue: gachaClient },
        { provide: CollectionClientService, useValue: collectionClient },
        { provide: MediaService, useValue: mediaService },
        { provide: UserStore, useValue: userStore },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    })
      .overrideComponent(GachaPageComponent, {
        set: {
          styles: [''],
          imports: [
            StubLayoutComponent,
            MatButtonModule,
            MatButtonToggleModule,
            MatCardModule,
            MatCheckboxModule,
            MatIconModule,
            MatProgressSpinnerModule,
            MatSnackBarModule,
            MatTabsModule,
            GachaDisplayCardComponent,
          ],
        },
      })
      .overrideComponent(GachaDisplayCardComponent, {
        set: { styles: [''] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(GachaPageComponent);
    const componentWithSnackBar = fixture.componentInstance as unknown as { snackBar: MatSnackBar };
    const snackBarOpenSpy = vi.spyOn(componentWithSnackBar.snackBar, 'open').mockImplementation(() => undefined as never);
    fixture.detectChanges();

    return { fixture, component: fixture.componentInstance, gachaClient, collectionClient, mediaService, snackBar: { open: snackBarOpenSpy } };
  }

  it('loads balance, stats, and collection on init', async () => {
    const { fixture, gachaClient, collectionClient, mediaService } = await createComponent();

    expect(gachaClient.getBalance).toHaveBeenCalledOnce();
    expect(gachaClient.getStats).toHaveBeenCalledOnce();
    expect(collectionClient.list).toHaveBeenCalledWith({ rarity_tier: undefined, duplicates_only: undefined });
    expect(mediaService.getThumbnailUrl).toHaveBeenCalledWith('m1');

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('10');
    expect(element.textContent).toContain('Pool stats');
  });

  it('hides already loaded NSFW collection cards when the viewer setting is disabled', async () => {
    const nsfwItem: CollectionItemRead = {
      ...collectionItem,
      id: 'ci2',
      media_id: 'm2',
      media: { id: 'm2', filename: 'alter.webp', is_nsfw: true, is_sensitive: false },
    };

    const { component } = await createComponent({
      collectionItems: [collectionItem, nsfwItem],
      showNsfw: false,
    });

    expect(component.collection()).toHaveLength(2);
    expect(component.visibleCollection().map((item) => item.id)).toEqual(['ci1']);
  });

  it('claims daily currency and disables the unavailable claim state', async () => {
    const { component, gachaClient, snackBar } = await createComponent();

    component.claimDaily();

    expect(gachaClient.claimDaily).toHaveBeenCalledOnce();
    expect(component.balanceValue()).toBe(20);
    expect(component.canClaimDaily()).toBe(false);
    expect(snackBar.open).toHaveBeenCalledWith('Claimed 10 currency.', 'Close', { duration: 3500 });
  });

  it('sends single and ten-pull modes', async () => {
    vi.useFakeTimers();
    const { component, gachaClient } = await createComponent({ balance: 30 });

    component.pull(GachaPullMode.SINGLE);
    component.skipAnimation();
    component.pull(GachaPullMode.TEN_PULL);

    expect(gachaClient.pull).toHaveBeenNthCalledWith(1, { mode: GachaPullMode.SINGLE });
    expect(gachaClient.pull).toHaveBeenNthCalledWith(2, { mode: GachaPullMode.TEN_PULL });
  });

  it('shows prices and disables pull buttons when balance is insufficient', async () => {
    const { fixture, component } = await createComponent({ balance: 0 });

    expect(component.canSinglePull()).toBe(false);
    expect(component.canTenPull()).toBe(false);

    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    const single = buttons.find((button) => button.textContent?.includes('Single'));
    const tenPull = buttons.find((button) => button.textContent?.includes('10 Pulls'));
    expect(single?.textContent).toContain('1');
    expect(tenPull?.textContent).toContain('9');
    expect(single?.disabled).toBe(true);
    expect(tenPull?.disabled).toBe(true);
  });

  it('runs and skips the cinematic reveal animation', async () => {
    vi.useFakeTimers();
    const { component } = await createComponent({ balance: 20 });

    component.pull(GachaPullMode.TEN_PULL);
    expect(component.animationState()).toBe('summoning');

    vi.advanceTimersByTime(900);
    expect(component.animationState()).toBe('charging');

    component.skipAnimation();
    expect(component.animationState()).toBe('complete');
    expect(component.pullResults()[0].rarity_tier).toBe(RarityTier.UR);
    expect(component.pullResults()[0].thumbnail_url).toBe('blob:m1');
  });

  it('filters and renders collection cards', async () => {
    const { fixture, component, collectionClient } = await createComponent();

    component.onRarityFilterChange(RarityTier.SR);
    component.toggleDuplicatesOnly(true);
    const tabGroup = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabGroup.selectedIndex = 1;
    fixture.detectChanges();

    expect(collectionClient.list).toHaveBeenCalledWith({ rarity_tier: RarityTier.SR, duplicates_only: undefined });
    expect(collectionClient.list).toHaveBeenCalledWith({ rarity_tier: RarityTier.SR, duplicates_only: true });
    expect(component.collection()[0].media?.filename).toBe('saber.webp');
    expect(component.collection()[0].level).toBe(2);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('saber.webp');
  });

  it('shows API errors in a snackbar', async () => {
    const error = new HttpErrorResponse({
      status: 409,
      statusText: 'Conflict',
      error: { detail: 'Not enough gacha currency' },
    });
    const { component, snackBar } = await createComponent({ balance: 10, pullError: error });

    component.pull(GachaPullMode.SINGLE);

    expect(snackBar.open).toHaveBeenCalledWith('Not enough gacha currency', 'Close', { duration: 5000 });
  });
});
