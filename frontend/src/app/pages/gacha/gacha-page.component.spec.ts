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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabGroup, MatTabsModule } from '@angular/material/tabs';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { CollectionItemRead } from '../../models/collection';
import { GachaPullMode, RarityTier } from '../../models/gacha';
import { MediaType } from '../../models/media';
import { TradeOfferRead, TradeSide, TradeStatus } from '../../models/trade';
import { MediaService } from '../../services/media.service';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { UserStore } from '../../services/user.store';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { CollectionClientService } from '../../services/web/collection-client.service';
import { GachaClientService } from '../../services/web/gacha-client.service';
import { TradesClientService } from '../../services/web/trades-client.service';
import { GachaCardInspectorDialogComponent } from './gacha-card-inspector/gacha-card-inspector.component';
import { GachaCollectionBrowserComponent } from './gacha-collection-browser/gacha-collection-browser.component';
import { GachaDisplayCardComponent } from './gacha-display-card/gacha-display-card.component';
import { GachaPageComponent } from './gacha-page.component';
import { GachaRarityParticlesComponent } from './gacha-rarity-particles/gacha-rarity-particles.component';

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
  media: {
    id: 'm1',
    filename: 'saber.webp',
    media_type: MediaType.IMAGE,
    is_nsfw: false,
    is_sensitive: false,
    tags: ['white hair'],
    entities: [
      {
        id: 'e1',
        entity_type: 'character' as any,
        entity_id: null,
        name: 'Saber',
        role: 'primary',
        source: 'manual',
        confidence: null,
      },
      {
        id: 'e2',
        entity_type: 'series' as any,
        entity_id: null,
        name: 'Fate',
        role: 'primary',
        source: 'manual',
        confidence: null,
      },
    ],
  },
};

const outgoingTrade: TradeOfferRead = {
  id: 't-active',
  sender_user_id: 'u1',
  receiver_user_id: 'u2',
  status: TradeStatus.PENDING,
  message: 'Want to trade?',
  created_at: '2026-04-28T00:00:00Z',
  updated_at: '2026-04-28T00:00:00Z',
  expires_at: null,
  items: [
    {
      id: 'toi-offered',
      trade_offer_id: 't-active',
      side: TradeSide.SENDER,
      collection_item_id: 'ci1',
      collection_item: { ...collectionItem, locked: false },
    },
    {
      id: 'toi-requested',
      trade_offer_id: 't-active',
      side: TradeSide.RECEIVER,
      collection_item_id: 'ci1-their',
      collection_item: { ...collectionItem, id: 'ci1-their', user_id: 'u2', locked: false },
    },
  ],
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
    outgoingTrades?: TradeOfferRead[];
    pullError?: unknown;
    showNsfw?: boolean;
    showSensitive?: boolean;
    confirm?: boolean;
    routeState?: {
      tab?: string;
      inspect?: string;
    };
  } = {}) {
    const balance = options.balance ?? 6000;
    const dailyAvailable = options.dailyAvailable ?? true;
    let currentBalance = balance;
    let currentDailyAvailable = dailyAvailable;
    let collectionItems = options.collectionItems ?? [collectionItem];
    let outgoingTrades = options.outgoingTrades ?? [];
    const pullResponse = {
      id: 'p1',
      user_id: 'u1',
      mode: GachaPullMode.TEN_PULL,
      pool: null,
      currency_spent: 1200,
      currency_balance: Math.max(balance - 1200, 0),
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
        total_claimed: 6000,
        total_spent: 0,
        last_daily_claimed_on: currentDailyAvailable ? null : '2026-04-28',
        daily_claim_amount: 6000,
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
        currentBalance += 6000;
        currentDailyAvailable = false;
        return of({
          claimed: 6000,
          balance: currentBalance,
          daily_claim_available: false,
          next_daily_claim_at: '2026-04-29T00:00:00Z',
        });
      }),
      pull: vi.fn(() => options.pullError ? throwError(() => options.pullError) : of(pullResponse)),
    };
    const collectionClient = {
      list: vi.fn(() => of({ total: collectionItems.length, items: collectionItems })),
      listPublicOwners: vi.fn(() => of({
        total: 1,
        items: [{ user_id: 'u2', username: 'sakura', allow_trade_requests: true, show_stats: true }],
      })),
      listUser: vi.fn(() => of({ total: collectionItems.length, items: collectionItems.map((item) => ({ ...item, user_id: 'u2', id: `${item.id}-their` })) })),
      discardItem: vi.fn((id: string) => {
        const current = collectionItems.find((item) => item.id === id) ?? collectionItems[0];
        const remaining = Math.max(current.copies_pulled - 1, 0);
        const updated = remaining > 0 ? { ...current, copies_pulled: remaining } : null;
        collectionItems = updated
          ? collectionItems.map((item) => item.id === id ? updated : item)
          : collectionItems.filter((item) => item.id !== id);
        currentBalance += 8;
        return of({
          item_id: id,
          media_id: current.media_id,
          copies_discarded: 1,
          pulls_awarded: 8,
          currency_balance: currentBalance,
          remaining_copies: remaining,
          item: updated,
        });
      }),
    };
    const tradesClient = {
      create: vi.fn(() => of({
        id: 't1',
        sender_user_id: 'u1',
        receiver_user_id: 'u2',
        status: 'pending',
        message: null,
        created_at: '2026-04-28T00:00:00Z',
        updated_at: '2026-04-28T00:00:00Z',
        expires_at: null,
        items: [],
      })),
      outgoing: vi.fn(() => of({ total: outgoingTrades.length, items: outgoingTrades })),
      cancel: vi.fn((id: string) => {
        const trade = outgoingTrades.find((item) => item.id === id) ?? outgoingTrade;
        outgoingTrades = outgoingTrades.filter((item) => item.id !== id);
        return of({ ...trade, status: TradeStatus.CANCELLED });
      }),
    };
    const mediaService = {
      getThumbnailUrl: vi.fn((id: string) => of(`blob:${id}`)),
      getFileUrl: vi.fn((id: string) => of(`blob:file:${id}`)),
      getPosterUrl: vi.fn((id: string) => of(`blob:poster:${id}`)),
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
    const confirmDialog = { open: vi.fn(() => of(options.confirm ?? true)) };
    const routeParamMap = new BehaviorSubject(convertToParamMap({
      ...(options.routeState?.tab ? { tab: options.routeState.tab } : {}),
    }));
    const routeQueryParamMap = new BehaviorSubject(convertToParamMap({
      ...(options.routeState?.inspect ? { inspect: options.routeState.inspect } : {}),
    }));
    const router = { navigate: vi.fn(() => Promise.resolve(true)) };

    await TestBed.configureTestingModule({
      imports: [GachaPageComponent, NoopAnimationsModule],
      providers: [
        { provide: GachaClientService, useValue: gachaClient },
        { provide: CollectionClientService, useValue: collectionClient },
        { provide: MediaService, useValue: mediaService },
        { provide: TradesClientService, useValue: tradesClient },
        { provide: UserStore, useValue: userStore },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ConfirmDialogService, useValue: confirmDialog },
        ...(options.routeState
          ? [
              { provide: ActivatedRoute, useValue: { paramMap: routeParamMap, queryParamMap: routeQueryParamMap } },
              { provide: Router, useValue: router },
            ]
          : []),
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
            MatFormFieldModule,
            MatIconModule,
            MatInputModule,
            MatProgressSpinnerModule,
            MatDialogModule,
            MatSnackBarModule,
            MatTabsModule,
            GachaCollectionBrowserComponent,
            GachaDisplayCardComponent,
            GachaRarityParticlesComponent,
          ],
        },
      })
      .overrideComponent(GachaCollectionBrowserComponent, {
        set: { styles: [''] },
      })
      .overrideComponent(GachaDisplayCardComponent, {
        set: { styles: [''] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(GachaPageComponent);
    const componentWithSnackBar = fixture.componentInstance as unknown as { snackBar: MatSnackBar };
    const snackBarOpenSpy = vi.spyOn(componentWithSnackBar.snackBar, 'open').mockImplementation(() => undefined as never);
    fixture.detectChanges();

    return {
      fixture,
      component: fixture.componentInstance,
      gachaClient,
      collectionClient,
      tradesClient,
      mediaService,
      confirmDialog,
      snackBar: { open: snackBarOpenSpy },
      router,
      routeParamMap,
      routeQueryParamMap,
    };
  }

  it('loads balance, stats, and collection on init', async () => {
    const { fixture, gachaClient, collectionClient, tradesClient, mediaService } = await createComponent();

    expect(gachaClient.getBalance).toHaveBeenCalledOnce();
    expect(gachaClient.getStats).toHaveBeenCalledOnce();
    expect(collectionClient.list).toHaveBeenCalledWith(expect.objectContaining({ rarity_tier: undefined, duplicates_only: undefined }));
    expect(mediaService.getFileUrl).not.toHaveBeenCalled();
    expect(tradesClient.outgoing).toHaveBeenCalledOnce();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('6000');
    expect(element.textContent).toContain('Pulls');
    expect(element.textContent).toContain('Pool stats');
  });

  it('hides already loaded NSFW collection cards when the viewer setting is disabled', async () => {
    const nsfwItem: CollectionItemRead = {
      ...collectionItem,
      id: 'ci2',
      media_id: 'm2',
      media: { id: 'm2', filename: 'alter.webp', is_nsfw: true, is_sensitive: false, tags: [], entities: [] },
    };

    const { fixture, component } = await createComponent({
      collectionItems: [collectionItem, nsfwItem],
      showNsfw: false,
    });

    expect(component.collection()).toHaveLength(2);
    expect(component.hideNsfw()).toBe(true);
    const tabGroup = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabGroup.selectedIndex = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Saber');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('alter.webp');
  });

  it('claims daily currency and disables the unavailable claim state', async () => {
    const { component, gachaClient, snackBar } = await createComponent();

    component.claimDaily();

    expect(gachaClient.claimDaily).toHaveBeenCalledOnce();
    expect(component.balanceValue()).toBe(12000);
    expect(component.canClaimDaily()).toBe(false);
    expect(snackBar.open).toHaveBeenCalledWith('Claimed 6000 Pulls.', 'Close', { duration: 3500 });
  });

  it('sends single and ten-pull modes', async () => {
    vi.useFakeTimers();
    const { component, gachaClient } = await createComponent({ balance: 2400 });

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
    expect(single?.textContent).toContain('120');
    expect(tenPull?.textContent).toContain('1200');
    expect(single?.disabled).toBe(true);
    expect(tenPull?.disabled).toBe(true);
  });

  it('runs and skips the cinematic reveal animation', async () => {
    vi.useFakeTimers();
    const { component } = await createComponent({ balance: 1200 });

    component.pull(GachaPullMode.TEN_PULL);
    expect(component.animationState()).toBe('summoning');

    vi.advanceTimersByTime(900);
    expect(component.animationState()).toBe('charging');

    component.skipAnimation();
    expect(component.animationState()).toBe('complete');
    expect(component.pullResults()[0].rarity_tier).toBe(RarityTier.UR);
    expect(component.pullResults()[0].thumbnail_url).toBeNull();
  });

  it('filters and renders collection cards', async () => {
    const { fixture, component, collectionClient } = await createComponent();

    component.onRarityFilterChange(RarityTier.SR);
    component.toggleDuplicatesOnly(true);
    const tabGroup = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabGroup.selectedIndex = 1;
    fixture.detectChanges();

    expect(collectionClient.list).toHaveBeenCalledWith(expect.objectContaining({ rarity_tier: RarityTier.SR, duplicates_only: undefined }));
    expect(collectionClient.list).toHaveBeenCalledWith(expect.objectContaining({ rarity_tier: RarityTier.SR, duplicates_only: true }));
    expect(component.collection()[0].media?.entities[0]?.name).toBe('Saber');
    expect(component.collection()[0].level).toBe(2);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Saber');
  });

  it('syncs gacha tabs to route segments', async () => {
    const { fixture, component, router } = await createComponent({ routeState: { tab: 'collection' } });

    expect(component.activeTab()).toBe('collection');

    router.navigate.mockClear();
    component.onSelectedTabIndexChange(2);

    expect(router.navigate).toHaveBeenCalledWith(['/gacha', 'collectors'], {
      queryParams: { inspect: null },
      queryParamsHandling: 'merge',
    });
  });

  it('destroys one collection copy for Pulls after confirmation', async () => {
    const { fixture, component, collectionClient, confirmDialog, snackBar } = await createComponent({
      collectionItems: [{ ...collectionItem, locked: false }],
    });

    const tabGroup = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabGroup.selectedIndex = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const discardButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.collection-discard-button');
    expect(discardButton?.getAttribute('aria-label')).toContain('+8 Pulls');
    discardButton?.click();

    expect(confirmDialog.open).toHaveBeenCalledWith({
      title: 'Destroy card?',
      message: 'Destroy one copy of this card. You will receive 8 Pulls.',
      confirmLabel: 'Destroy for 8 Pulls',
      tone: 'warn',
    });
    expect(collectionClient.discardItem).toHaveBeenCalledWith('ci1');
    expect(component.balanceValue()).toBe(6008);
    expect(snackBar.open).toHaveBeenCalledWith('Destroyed 1 copy for 8 Pulls.', 'Close', { duration: 3500 });
  });

  it('does not show destroy actions in collector trade panes', async () => {
    const { fixture, component } = await createComponent({
      collectionItems: [{ ...collectionItem, locked: false }],
    });

    component.selectOwner(component.owners()[0]);
    const tabGroup = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabGroup.selectedIndex = 2;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.collection-discard-button')).toBeNull();
  });

  it('renders compact collection cards without metadata chips', async () => {
    const rawNamedItem: CollectionItemRead = {
      ...collectionItem,
      media: {
        ...collectionItem.media!,
        filename: '6148b148b8904f99b1abf48080f6.webp',
        tags: ['little_busters', 'bat_hair_ornament'],
        entities: [
          {
            ...collectionItem.media!.entities[0],
            name: 'noumi_kudryavka',
          },
          {
            ...collectionItem.media!.entities[1],
            name: 'little_busters',
          },
        ],
      },
    };
    const { fixture } = await createComponent({ collectionItems: [rawNamedItem] });

    const tabGroup = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabGroup.selectedIndex = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Noumi Kudryavka');
    expect(text).toContain('3 copies');
    expect(text).not.toContain('Little Busters');
    expect(text).not.toContain('Bat Hair Ornament');
    expect(text).not.toContain('Tradeable');
    expect(text).not.toContain('Lv. 2');
    expect(text).not.toContain('noumi_kudryavka');
    expect(text).not.toContain('6148b148b8904f99b1abf48080f6.webp');
  });

  it('opens the card inspector from collection cards', async () => {
    const { fixture, component } = await createComponent();
    const dialogOpenSpy = vi.spyOn((component as any).dialog, 'open').mockReturnValue({} as any);

    const tabGroup = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabGroup.selectedIndex = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const cardButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.collection-card-button');
    cardButton?.click();

    expect(dialogOpenSpy).toHaveBeenCalledWith(
      GachaCardInspectorDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          card: expect.objectContaining({
            mediaId: 'm1',
            rarity: RarityTier.SR,
            title: 'Saber',
            contextLabel: 'Your collection',
            tags: ['white hair'],
          }),
        }),
      }),
    );
  });

  it('opens and clears the gacha card inspector from the inspect route', async () => {
    const afterClosed = new Subject<void>();
    const { component, router, routeQueryParamMap } = await createComponent({ routeState: { tab: 'collection' } });
    const dialogOpenSpy = vi.spyOn((component as any).dialog, 'open').mockReturnValue({
      afterClosed: () => afterClosed,
    } as any);

    routeQueryParamMap.next(convertToParamMap({ inspect: 'ci1' }));

    expect(dialogOpenSpy).toHaveBeenCalledWith(
      GachaCardInspectorDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          card: expect.objectContaining({ id: 'ci1', mediaId: 'm1' }),
        }),
      }),
    );

    afterClosed.next();
    afterClosed.complete();

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.any(Object),
      queryParams: { inspect: null },
      queryParamsHandling: 'merge',
    });
  });

  it('opens pull result cards in the inspector', async () => {
    const { fixture, component } = await createComponent({ balance: 120 });
    const dialogOpenSpy = vi.spyOn((component as any).dialog, 'open').mockReturnValue({} as any);

    component.pull(GachaPullMode.SINGLE);
    component.skipAnimation();
    fixture.detectChanges();

    const resultButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.result-card-button');
    resultButton?.click();

    expect(dialogOpenSpy).toHaveBeenCalledWith(
      GachaCardInspectorDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          card: expect.objectContaining({
            mediaId: 'm1',
            rarity: RarityTier.UR,
            contextLabel: 'Pull result',
          }),
        }),
      }),
    );
  });

  it('keeps trade selection separate from card inspection', async () => {
    const { fixture, component } = await createComponent({
      collectionItems: [{ ...collectionItem, locked: false }],
    });
    const dialogOpenSpy = vi.spyOn((component as any).dialog, 'open').mockReturnValue({} as any);

    component.selectOwner(component.owners()[0]);
    const tabGroup = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabGroup.selectedIndex = 2;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const cardButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.collection-card-button');
    cardButton?.click();
    expect(dialogOpenSpy).toHaveBeenCalledOnce();
    expect(component.requestedItemIds().size).toBe(0);

    const selectButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.collection-select-button');
    selectButton?.click();
    expect(dialogOpenSpy).toHaveBeenCalledOnce();
    expect(component.requestedItemIds().has('ci1-their')).toBe(true);
  });

  it('sends metadata filters for the collection tab', async () => {
    const { component, collectionClient } = await createComponent();

    component.onTagFilterChange('white hair, sword');
    component.onCharacterFilterChange('Saber');
    component.onSeriesFilterChange('Fate');

    expect(collectionClient.list).toHaveBeenCalledWith(expect.objectContaining({
      tags: ['white hair', 'sword'],
      character_names: ['Saber'],
      series_names: ['Fate'],
    }));
  });

  it('loads public collectors and renders a selected collection', async () => {
    const { fixture, component, collectionClient } = await createComponent();

    const owner = component.owners()[0];
    component.selectOwner(owner);
    const tabGroup = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabGroup.selectedIndex = 2;
    fixture.detectChanges();

    expect(collectionClient.listPublicOwners).toHaveBeenCalled();
    expect(collectionClient.listUser).toHaveBeenCalledWith('u2', expect.any(Object));
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('sakura');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain("sakura's collection");
  });

  it('keeps non-tradeable high rarity cards visible in viewed collections', async () => {
    const urItem: CollectionItemRead = {
      ...collectionItem,
      id: 'ci-ur',
      media_id: 'm-ur',
      rarity_tier_at_acquisition: RarityTier.UR,
      locked: true,
      tradeable: false,
      media: { id: 'm-ur', filename: 'excalibur.webp', is_nsfw: false, is_sensitive: false, tags: ['sword'], entities: [] },
    };
    const { component } = await createComponent({
      collectionItems: [{ ...collectionItem, locked: false }, urItem],
    });

    component.selectOwner(component.owners()[0]);

    expect(component.viewedCollection().map((item) => item.id)).toEqual(['ci1-their', 'ci-ur-their']);
    expect(component.canSelectRequestedItem(component.viewedCollection()[1])).toBe(false);
  });

  it('sends metadata filters for viewed collector collections', async () => {
    const { component, collectionClient } = await createComponent();

    component.selectOwner(component.owners()[0]);
    component.onViewedTagFilterChange('sword');
    component.onViewedCharacterFilterChange('Saber');
    component.onViewedSeriesFilterChange('Fate');

    expect(collectionClient.listUser).toHaveBeenCalledWith('u2', expect.objectContaining({
      tags: ['sword'],
      character_names: ['Saber'],
      series_names: ['Fate'],
    }));
  });

  it('creates a trade offer from selected requested and offered items', async () => {
    const { component, tradesClient, snackBar } = await createComponent({
      collectionItems: [{ ...collectionItem, locked: false }],
    });

    component.selectOwner(component.owners()[0]);
    component.toggleRequestedItem(component.viewedCollection()[0]);
    component.toggleOfferedItem(component.tradeOwnCollection()[0]);
    component.onTradeMessageChange('Want to trade?');
    component.createTrade();

    expect(tradesClient.create).toHaveBeenCalledWith({
      receiver_user_id: 'u2',
      offered_item_ids: ['ci1'],
      requested_item_ids: ['ci1-their'],
      message: 'Want to trade?',
    });
    expect(component.offeredItemIds().size).toBe(0);
    expect(component.requestedItemIds().size).toBe(0);
    expect(snackBar.open).toHaveBeenCalledWith('Trade offer sent to sakura.', 'Close', { duration: 3500 });
    expect(tradesClient.outgoing).toHaveBeenCalledTimes(2);
  });

  it('renders and cancels active outgoing trade offers', async () => {
    const { fixture, component, tradesClient, snackBar } = await createComponent({
      collectionItems: [{ ...collectionItem, locked: false }],
      outgoingTrades: [outgoingTrade],
    });

    const tabGroup = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabGroup.selectedIndex = 2;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Active offers');
    expect(element.textContent).toContain('Want to trade?');
    expect(element.textContent).toContain('You offer');
    expect(element.textContent).toContain('You request');

    const cancelButton = Array.from(element.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Cancel offer'));
    cancelButton?.click();

    expect(tradesClient.cancel).toHaveBeenCalledWith('t-active');
    expect(component.outgoingTrades()).toHaveLength(0);
    expect(snackBar.open).toHaveBeenCalledWith('Trade offer cancelled.', 'Close', { duration: 3500 });
  });

  it('shows API errors in a snackbar', async () => {
    const error = new HttpErrorResponse({
      status: 409,
      statusText: 'Conflict',
      error: { detail: 'Not enough gacha currency' },
    });
    const { component, snackBar } = await createComponent({ balance: 120, pullError: error });

    component.pull(GachaPullMode.SINGLE);

    expect(snackBar.open).toHaveBeenCalledWith('Not enough gacha currency', 'Close', { duration: 5000 });
  });
});

describe('GachaDisplayCardComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows triangle particle layer only for revealed UR cards', async () => {
    await TestBed.configureTestingModule({
      imports: [GachaDisplayCardComponent],
      providers: [{
        provide: MediaService,
        useValue: {
          getThumbnailUrl: vi.fn(() => of('blob:thumb')),
          getPosterUrl: vi.fn(() => of('blob:poster')),
        },
      }],
    }).compileComponents();

    const fixture = TestBed.createComponent(GachaDisplayCardComponent);
    fixture.componentRef.setInput('rarity', RarityTier.UR);
    fixture.componentRef.setInput('revealed', false);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('zukan-gacha-rarity-particles')).toBeNull();

    fixture.componentRef.setInput('revealed', true);
    fixture.detectChanges();
    expect(element.querySelector('zukan-gacha-rarity-particles')).not.toBeNull();

    fixture.componentRef.setInput('rarity', RarityTier.SR);
    fixture.detectChanges();
    expect(element.querySelector('zukan-gacha-rarity-particles')).toBeNull();
  });

  it('renders the current upgrade level as stars and material class', async () => {
    await TestBed.configureTestingModule({
      imports: [GachaDisplayCardComponent],
      providers: [{
        provide: MediaService,
        useValue: {
          getThumbnailUrl: vi.fn(() => of('blob:thumb')),
          getPosterUrl: vi.fn(() => of('blob:poster')),
        },
      }],
    }).compileComponents();

    const fixture = TestBed.createComponent(GachaDisplayCardComponent);
    fixture.componentRef.setInput('rarity', RarityTier.SR);
    fixture.componentRef.setInput('level', 4);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const card = element.querySelector('.gacha-card');
    const stars = element.querySelectorAll('.gacha-card__star');

    expect(card?.classList.contains('star-level-4')).toBe(true);
    expect(element.querySelector('.gacha-card__stars')?.getAttribute('aria-label')).toBe('Level 4 of 5');
    expect(stars.length).toBe(5);
    expect(element.querySelectorAll('.gacha-card__star--active').length).toBe(4);

    fixture.componentRef.setInput('level', 8);
    fixture.detectChanges();

    expect(element.querySelector('.gacha-card')?.classList.contains('star-level-5')).toBe(true);
    expect(element.querySelector('.gacha-card__stars')?.getAttribute('aria-label')).toBe('Level 5 of 5');
  });
});

describe('GachaCardInspectorDialogComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders normalized metadata and collection state', async () => {
    const close = vi.fn();
    const navigate = vi.fn(() => Promise.resolve(true));
    const searchService = {
      suppressNextUrlSync: vi.fn(),
      addMetadataFilter: vi.fn(),
      toQueryParamsWithClears: vi.fn(() => ({ tag: ['bat_hair_ornament'] })),
    };
    await TestBed.configureTestingModule({
      imports: [GachaCardInspectorDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: { close } },
        { provide: Router, useValue: { navigate } },
        { provide: NavbarSearchService, useValue: searchService },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            card: {
              id: 'ci1',
              mediaId: 'm1',
              rarity: RarityTier.UR,
              title: 'noumi_kudryavka',
              thumbnailUrl: 'blob:m1',
              contextLabel: 'Your collection',
              level: 4,
              copiesPulled: 3,
              locked: true,
              tradeable: true,
              tags: ['little_busters', 'bat_hair_ornament'],
              characters: ['noumi_kudryavka'],
              series: ['little_busters'],
            },
          },
        },
        {
          provide: MediaService,
          useValue: {
            get: vi.fn(() => throwError(() => new Error('not available'))),
            getFileUrl: vi.fn(),
            getPosterUrl: vi.fn(),
          },
        },
      ],
    })
      .overrideComponent(GachaCardInspectorDialogComponent, {
        set: { styles: [''] },
      })
      .overrideComponent(GachaDisplayCardComponent, {
        set: { styles: [''] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(GachaCardInspectorDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Noumi Kudryavka');
    expect(text).toContain('Little Busters');
    expect(text).toContain('Bat Hair Ornament');
    expect(text).toContain('Locked');
    expect(text).toContain('Tradeable');
    expect(text).toContain('3 copies');

    const tagChip = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Bat Hair Ornament'));
    tagChip?.click();

    expect(searchService.addMetadataFilter).toHaveBeenCalledWith('tag', 'bat_hair_ornament');
    expect(navigate).toHaveBeenCalledWith(['/gallery'], { queryParams: { tag: ['bat_hair_ornament'] } });
    expect(close).toHaveBeenCalled();
  });

  it('opens the source media inspector from the card title', async () => {
    const close = vi.fn();
    const navigate = vi.fn(() => Promise.resolve(true));
    await TestBed.configureTestingModule({
      imports: [GachaCardInspectorDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: { close } },
        { provide: Router, useValue: { navigate } },
        { provide: NavbarSearchService, useValue: { suppressNextUrlSync: vi.fn(), addMetadataFilter: vi.fn(), toQueryParamsWithClears: vi.fn(() => ({})) } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            card: {
              id: 'ci1',
              mediaId: 'm-public',
              rarity: RarityTier.SR,
              title: 'shared_card',
              thumbnailUrl: 'blob:m-public',
              contextLabel: 'Collector collection',
              mediaInspectorPath: '/gallery',
              currentUserId: 'u1',
            },
          },
        },
        {
          provide: MediaService,
          useValue: {
            get: vi.fn(() => of({
              id: 'm-public',
              owner_id: 'u2',
              uploader_id: 'u2',
              media_type: 'image',
              tags: [],
              entities: [],
            } as any)),
            getFileUrl: vi.fn(() => of('blob:file')),
            getPosterUrl: vi.fn(),
          },
        },
      ],
    })
      .overrideComponent(GachaCardInspectorDialogComponent, {
        set: { styles: [''] },
      })
      .overrideComponent(GachaDisplayCardComponent, {
        set: { styles: [''] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(GachaCardInspectorDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.card-inspector__title-link')?.click();

    expect(navigate).toHaveBeenCalledWith(['/browse'], { queryParams: { inspect: 'm-public' } });
    expect(close).toHaveBeenCalled();
  });
});
