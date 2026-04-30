import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, OnInit, WritableSignal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { EMPTY, catchError, finalize, forkJoin, of } from 'rxjs';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { CollectionItemRead, CollectionListResponse, CollectionOwnerRead } from '../../models/collection';
import {
  GachaCurrencyBalanceRead,
  GachaDailyClaimResponse,
  GachaPullItemRead,
  GachaPullMode,
  GachaPullRead,
  GachaStatsResponse,
  RarityTier,
} from '../../models/gacha';
import { MediaEntityType } from '../../models/relations';
import { TradeOfferItemRead, TradeOfferRead, TradeSide, TradeStatus } from '../../models/trade';
import { MediaService } from '../../services/media.service';
import { UserStore } from '../../services/user.store';
import { CollectionClientService } from '../../services/web/collection-client.service';
import { GachaClientService } from '../../services/web/gacha-client.service';
import { TradesClientService } from '../../services/web/trades-client.service';
import { extractApiError } from '../../utils/api-error.utils';
import { formatMetadataName } from '../../utils/media-display.utils';
import { GachaCardInspectorDialogComponent, GachaInspectorCard } from './gacha-card-inspector/gacha-card-inspector.component';
import { GachaCollectionBrowserComponent, GachaCollectionCard } from './gacha-collection-browser/gacha-collection-browser.component';
import { GachaDisplayCardComponent } from './gacha-display-card/gacha-display-card.component';

type AnimationState = 'idle' | 'summoning' | 'charging' | 'reveal' | 'complete';

interface PullResultCard extends GachaPullItemRead {
  thumbnail_url: string | null;
}

const SINGLE_PULL_COST = 1;
const TEN_PULL_COST = 9;
const RARITY_ORDER = [RarityTier.N, RarityTier.R, RarityTier.SR, RarityTier.SSR, RarityTier.UR];
const RARITY_RANK = new Map(RARITY_ORDER.map((tier, index) => [tier, index]));
const PULL_PAYOUT_BY_RARITY: Record<RarityTier, number> = {
  [RarityTier.N]: 1,
  [RarityTier.R]: 2,
  [RarityTier.SR]: 4,
  [RarityTier.SSR]: 7,
  [RarityTier.UR]: 10,
};

@Component({
  selector: 'zukan-gacha-page',
  imports: [
    LayoutComponent,
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
  ],
  templateUrl: './gacha-page.component.html',
  styleUrl: './gacha-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GachaPageComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly gachaClient = inject(GachaClientService);
  private readonly collectionClient = inject(CollectionClientService);
  private readonly tradesClient = inject(TradesClientService);
  private readonly mediaService = inject(MediaService);
  private readonly userStore = inject(UserStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly reducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  readonly singlePullCost = SINGLE_PULL_COST;
  readonly tenPullCost = TEN_PULL_COST;
  readonly GachaPullMode = GachaPullMode;
  readonly TradeSide = TradeSide;
  readonly rarityTiers = RARITY_ORDER;

  readonly balance = signal<GachaCurrencyBalanceRead | null>(null);
  readonly stats = signal<GachaStatsResponse | null>(null);
  readonly collection = signal<GachaCollectionCard[]>([]);
  readonly collectionTotal = signal(0);
  readonly rarityFilter = signal<RarityTier | null>(null);
  readonly duplicatesOnly = signal(false);
  readonly tagFilter = signal('');
  readonly characterFilter = signal('');
  readonly seriesFilter = signal('');
  readonly owners = signal<CollectionOwnerRead[]>([]);
  readonly ownerSearch = signal('');
  readonly selectedOwnerId = signal<string | null>(null);
  readonly loadingOwners = signal(false);
  readonly ownersError = signal<string | null>(null);
  readonly viewedCollection = signal<GachaCollectionCard[]>([]);
  readonly viewedRarityFilter = signal<RarityTier | null>(null);
  readonly viewedDuplicatesOnly = signal(false);
  readonly viewedTagFilter = signal('');
  readonly viewedCharacterFilter = signal('');
  readonly viewedSeriesFilter = signal('');
  readonly loadingViewedCollection = signal(false);
  readonly viewedCollectionError = signal<string | null>(null);
  readonly tradeOwnCollection = signal<GachaCollectionCard[]>([]);
  readonly loadingTradeOwnCollection = signal(false);
  readonly tradeOwnCollectionError = signal<string | null>(null);
  readonly requestedItemIds = signal<ReadonlySet<string>>(new Set());
  readonly offeredItemIds = signal<ReadonlySet<string>>(new Set());
  readonly tradeMessage = signal('');
  readonly tradeSubmitting = signal(false);
  readonly outgoingTrades = signal<TradeOfferRead[]>([]);
  readonly loadingOutgoingTrades = signal(false);
  readonly outgoingTradesError = signal<string | null>(null);
  readonly cancellingTradeIds = signal<ReadonlySet<string>>(new Set());
  readonly loadingOverview = signal(false);
  readonly loadingCollection = signal(false);
  readonly collectionError = signal<string | null>(null);
  readonly discardLoadingIds = signal<ReadonlySet<string>>(new Set());
  readonly claimLoading = signal(false);
  readonly pullLoading = signal(false);
  readonly animationState = signal<AnimationState>('idle');
  readonly pullResults = signal<PullResultCard[]>([]);
  readonly activePullMode = signal<GachaPullMode | null>(null);

  readonly balanceValue = computed(() => this.balance()?.balance ?? this.stats()?.currency_balance ?? 0);
  readonly dailyClaimAvailable = computed(() => this.balance()?.daily_claim_available ?? this.stats()?.daily_claim_available ?? false);
  readonly dailyClaimAmount = computed(() => this.balance()?.daily_claim_amount ?? 10);
  readonly nextDailyClaimAt = computed(() => this.balance()?.next_daily_claim_at ?? this.stats()?.next_daily_claim_at ?? null);
  readonly hideNsfw = computed(() => !this.userStore.currentUser()?.show_nsfw);
  readonly hideSensitive = computed(() => this.userStore.currentUser()?.show_sensitive === false);
  readonly selectedOwner = computed(() => this.owners().find((owner) => owner.user_id === this.selectedOwnerId()) ?? null);
  readonly canCreateTrade = computed(() => Boolean(
    this.selectedOwner()
      && this.requestedItemIds().size > 0
      && this.offeredItemIds().size > 0
      && !this.tradeSubmitting(),
  ));
  readonly animationActive = computed(() => !['idle', 'complete'].includes(this.animationState()));
  readonly canClaimDaily = computed(() => !this.claimLoading() && !this.loadingOverview() && this.dailyClaimAvailable());
  readonly canSinglePull = computed(() => this.canPull(SINGLE_PULL_COST));
  readonly canTenPull = computed(() => this.canPull(TEN_PULL_COST));
  readonly highestRarity = computed(() => this.highestTier(this.pullResults()));
  readonly rareReveal = computed(() => {
    const tier = this.highestRarity();
    return tier === RarityTier.SSR || tier === RarityTier.UR;
  });
  readonly pullStageLabel = computed(() => {
    switch (this.animationState()) {
      case 'summoning':
        return 'Summoning';
      case 'charging':
        return this.rareReveal() ? 'Rare aura detected' : 'Charging';
      case 'reveal':
        return 'Reveal';
      case 'complete':
        return 'Results';
      default:
        return 'Ready';
    }
  });

  ngOnInit(): void {
    this.loadOverview();
    this.loadCollection();
    this.loadOwners();
    this.loadTradeOwnCollection();
    this.loadOutgoingTrades();
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  loadOverview(): void {
    this.loadingOverview.set(true);
    forkJoin({
      balance: this.gachaClient.getBalance(),
      stats: this.gachaClient.getStats(),
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError((err) => {
        this.loadingOverview.set(false);
        this.snackBar.open(extractApiError(err, 'Unable to load gacha status.'), 'Close', { duration: 5000 });
        return EMPTY;
      }),
    ).subscribe(({ balance, stats }) => {
      this.balance.set(balance);
      this.stats.set(stats);
      this.loadingOverview.set(false);
    });
  }

  loadCollection(): void {
    this.loadingCollection.set(true);
    this.collectionError.set(null);
    this.collectionClient.list({
      rarity_tier: this.rarityFilter() ?? undefined,
      tags: this.parseFilterList(this.tagFilter()),
      character_names: this.parseFilterList(this.characterFilter()),
      series_names: this.parseFilterList(this.seriesFilter()),
      duplicates_only: this.duplicatesOnly() || undefined,
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError((err) => {
        this.loadingCollection.set(false);
        this.collectionError.set(extractApiError(err, 'Unable to load collection.'));
        return of<CollectionListResponse>({ total: 0, items: [] });
      }),
    ).subscribe((response) => {
      this.collectionTotal.set(response.total);
      this.collection.set(this.toCollectionCards(response.items));
      this.loadingCollection.set(false);
      this.loadCollectionThumbnails(response.items);
    });
  }

  loadOwners(): void {
    this.loadingOwners.set(true);
    this.ownersError.set(null);
    const q = this.ownerSearch().trim();
    this.collectionClient.listPublicOwners({
      q: q || undefined,
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError((err) => {
        this.loadingOwners.set(false);
        this.ownersError.set(extractApiError(err, 'Unable to load public collections.'));
        return of({ total: 0, items: [] });
      }),
    ).subscribe((response) => {
      this.owners.set(response.items);
      this.loadingOwners.set(false);
      if (this.selectedOwnerId() && !response.items.some((owner) => owner.user_id === this.selectedOwnerId())) {
        this.clearSelectedOwner();
      }
    });
  }

  loadViewedCollection(): void {
    const owner = this.selectedOwner();
    if (!owner) {
      this.viewedCollection.set([]);
      return;
    }

    this.loadingViewedCollection.set(true);
    this.viewedCollectionError.set(null);
    this.collectionClient.listUser(owner.user_id, {
      rarity_tier: this.viewedRarityFilter() ?? undefined,
      tags: this.parseFilterList(this.viewedTagFilter()),
      character_names: this.parseFilterList(this.viewedCharacterFilter()),
      series_names: this.parseFilterList(this.viewedSeriesFilter()),
      duplicates_only: this.viewedDuplicatesOnly() || undefined,
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError((err) => {
        this.loadingViewedCollection.set(false);
        this.viewedCollectionError.set(extractApiError(err, 'Unable to load this collection.'));
        return of<CollectionListResponse>({ total: 0, items: [] });
      }),
    ).subscribe((response) => {
      this.viewedCollection.set(this.toCollectionCards(response.items));
      this.loadingViewedCollection.set(false);
      this.loadViewedCollectionThumbnails(response.items);
    });
  }

  loadTradeOwnCollection(): void {
    this.loadingTradeOwnCollection.set(true);
    this.tradeOwnCollectionError.set(null);
    this.collectionClient.list({ tradeable: true }).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError((err) => {
        this.loadingTradeOwnCollection.set(false);
        this.tradeOwnCollectionError.set(extractApiError(err, 'Unable to load your tradeable items.'));
        return of<CollectionListResponse>({ total: 0, items: [] });
      }),
    ).subscribe((response) => {
      const tradeableItems = response.items.filter((item) => this.isTradeableItem(item));
      this.tradeOwnCollection.set(this.toCollectionCards(tradeableItems));
      this.loadingTradeOwnCollection.set(false);
      this.loadTradeOwnCollectionThumbnails(tradeableItems);
    });
  }

  loadOutgoingTrades(): void {
    this.loadingOutgoingTrades.set(true);
    this.outgoingTradesError.set(null);
    this.tradesClient.outgoing().pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError((err) => {
        this.loadingOutgoingTrades.set(false);
        this.outgoingTradesError.set(extractApiError(err, 'Unable to load active trade offers.'));
        return of({ total: 0, items: [] });
      }),
    ).subscribe((response) => {
      this.outgoingTrades.set(response.items.filter((trade) => trade.status === TradeStatus.PENDING));
      this.loadingOutgoingTrades.set(false);
    });
  }

  claimDaily(): void {
    if (!this.canClaimDaily()) {
      return;
    }

    this.claimLoading.set(true);
    this.gachaClient.claimDaily().pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError((err) => {
        this.claimLoading.set(false);
        this.snackBar.open(extractApiError(err, 'Daily reward is not available yet.'), 'Close', { duration: 5000 });
        return EMPTY;
      }),
    ).subscribe((response) => {
      this.applyDailyClaim(response);
      this.claimLoading.set(false);
      this.snackBar.open(`Claimed ${response.claimed} Pulls.`, 'Close', { duration: 3500 });
      this.loadOverview();
    });
  }

  pull(mode: GachaPullMode): void {
    const cost = mode === GachaPullMode.TEN_PULL ? TEN_PULL_COST : SINGLE_PULL_COST;
    if (!this.canPull(cost)) {
      return;
    }

    this.pullLoading.set(true);
    this.gachaClient.pull({ mode }).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError((err) => {
        this.pullLoading.set(false);
        this.snackBar.open(extractApiError(err, 'Not enough gacha currency for this pull.'), 'Close', { duration: 5000 });
        return EMPTY;
      }),
    ).subscribe((pull) => {
      this.pullLoading.set(false);
      this.applyPullBalance(pull);
      this.activePullMode.set(mode);
      this.pullResults.set(this.toResultCards(pull.items));
      this.loadPullThumbnails(pull.items);
      this.runAnimation();
      this.loadOverview();
      this.loadCollection();
    });
  }

  skipAnimation(): void {
    if (!this.animationActive()) {
      return;
    }

    this.clearTimers();
    this.animationState.set('complete');
  }

  onRarityFilterChange(value: RarityTier | null): void {
    this.rarityFilter.set(value);
    this.loadCollection();
  }

  toggleDuplicatesOnly(checked: boolean): void {
    this.duplicatesOnly.set(checked);
    this.loadCollection();
  }

  onTagFilterChange(value: string): void {
    this.tagFilter.set(value);
    this.loadCollection();
  }

  onCharacterFilterChange(value: string): void {
    this.characterFilter.set(value);
    this.loadCollection();
  }

  onSeriesFilterChange(value: string): void {
    this.seriesFilter.set(value);
    this.loadCollection();
  }

  clearCollectionFilters(): void {
    this.rarityFilter.set(null);
    this.duplicatesOnly.set(false);
    this.tagFilter.set('');
    this.characterFilter.set('');
    this.seriesFilter.set('');
    this.loadCollection();
  }

  onOwnerSearchChange(value: string): void {
    this.ownerSearch.set(value);
    this.loadOwners();
  }

  selectOwner(owner: CollectionOwnerRead): void {
    this.selectedOwnerId.set(owner.user_id);
    this.requestedItemIds.set(new Set());
    this.loadViewedCollection();
  }

  clearSelectedOwner(): void {
    this.selectedOwnerId.set(null);
    this.viewedCollection.set([]);
    this.requestedItemIds.set(new Set());
  }

  onViewedRarityFilterChange(value: RarityTier | null): void {
    this.viewedRarityFilter.set(value);
    this.loadViewedCollection();
  }

  toggleViewedDuplicatesOnly(checked: boolean): void {
    this.viewedDuplicatesOnly.set(checked);
    this.loadViewedCollection();
  }

  onViewedTagFilterChange(value: string): void {
    this.viewedTagFilter.set(value);
    this.loadViewedCollection();
  }

  onViewedCharacterFilterChange(value: string): void {
    this.viewedCharacterFilter.set(value);
    this.loadViewedCollection();
  }

  onViewedSeriesFilterChange(value: string): void {
    this.viewedSeriesFilter.set(value);
    this.loadViewedCollection();
  }

  clearViewedCollectionFilters(): void {
    this.viewedRarityFilter.set(null);
    this.viewedDuplicatesOnly.set(false);
    this.viewedTagFilter.set('');
    this.viewedCharacterFilter.set('');
    this.viewedSeriesFilter.set('');
    this.loadViewedCollection();
  }

  toggleRequestedItem(item: GachaCollectionCard): void {
    if (!this.selectedOwner()?.allow_trade_requests || !this.isTradeableItem(item)) {
      return;
    }
    this.toggleSelection(this.requestedItemIds, item.id);
  }

  toggleOfferedItem(item: GachaCollectionCard): void {
    if (!this.isTradeableItem(item)) {
      return;
    }
    this.toggleSelection(this.offeredItemIds, item.id);
  }

  canSelectRequestedItem = (item: GachaCollectionCard): boolean => (
    Boolean(this.selectedOwner()?.allow_trade_requests) && this.isTradeableItem(item)
  );

  canSelectOfferedItem = (item: GachaCollectionCard): boolean => this.isTradeableItem(item);

  canDiscardCollectionItem = (item: GachaCollectionCard): boolean => !item.locked;

  discardPreview = (item: GachaCollectionCard): number => this.discardPullValue(item);

  onTradeMessageChange(value: string): void {
    this.tradeMessage.set(value);
  }

  createTrade(): void {
    const owner = this.selectedOwner();
    if (!owner || !this.canCreateTrade()) {
      return;
    }

    const offeredIds = Array.from(this.offeredItemIds());
    const requestedIds = Array.from(this.requestedItemIds());
    const message = this.tradeMessage().trim();

    this.tradeSubmitting.set(true);
    this.tradesClient.create({
      receiver_user_id: owner.user_id,
      offered_item_ids: offeredIds,
      requested_item_ids: requestedIds,
      message: message || null,
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.tradeSubmitting.set(false)),
      catchError((err) => {
        this.snackBar.open(extractApiError(err, 'Unable to create trade offer.'), 'Close', { duration: 5000 });
        return EMPTY;
      }),
    ).subscribe(() => {
      this.snackBar.open(`Trade offer sent to ${owner.username}.`, 'Close', { duration: 3500 });
      this.requestedItemIds.set(new Set());
      this.offeredItemIds.set(new Set());
      this.tradeMessage.set('');
      this.loadViewedCollection();
      this.loadTradeOwnCollection();
      this.loadOutgoingTrades();
    });
  }

  cancelTrade(trade: TradeOfferRead): void {
    if (trade.status !== TradeStatus.PENDING || this.cancellingTradeIds().has(trade.id)) {
      return;
    }

    this.cancellingTradeIds.update((current) => new Set(current).add(trade.id));
    this.tradesClient.cancel(trade.id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        this.cancellingTradeIds.update((current) => {
          const next = new Set(current);
          next.delete(trade.id);
          return next;
        });
      }),
      catchError((err) => {
        this.snackBar.open(extractApiError(err, 'Unable to cancel trade offer.'), 'Close', { duration: 5000 });
        return EMPTY;
      }),
    ).subscribe(() => {
      this.outgoingTrades.update((current) => current.filter((item) => item.id !== trade.id));
      this.snackBar.open('Trade offer cancelled.', 'Close', { duration: 3500 });
      this.loadViewedCollection();
      this.loadTradeOwnCollection();
    });
  }

  discardCollectionItem(item: GachaCollectionCard): void {
    if (!this.canDiscardCollectionItem(item) || this.discardLoadingIds().has(item.id)) {
      return;
    }

    const pulls = this.discardPullValue(item);
    const finalCopy = item.copies_pulled <= 1;
    const message = finalCopy
      ? `Destroy your final copy of this card for ${pulls} Pulls?`
      : `Destroy one copy of this card for ${pulls} Pulls?`;
    if (!window.confirm(message)) {
      return;
    }

    this.discardLoadingIds.update((current) => new Set(current).add(item.id));
    this.collectionClient.discardItem(item.id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        this.discardLoadingIds.update((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }),
      catchError((err) => {
        this.snackBar.open(extractApiError(err, 'Unable to destroy this card.'), 'Close', { duration: 5000 });
        return EMPTY;
      }),
    ).subscribe((response) => {
      this.applyDiscardResult(response.currency_balance, response.item);
      this.snackBar.open(`Destroyed 1 copy for ${response.pulls_awarded} Pulls.`, 'Close', { duration: 3500 });
      this.loadOverview();
      this.loadCollection();
      this.loadTradeOwnCollection();
    });
  }

  tierCount(tier: RarityTier): number {
    return this.stats()?.tier_counts?.[tier] ?? 0;
  }

  rarityClass(tier: RarityTier): string {
    return `rarity-${tier.toLowerCase()}`;
  }

  resultTrack(_: number, item: PullResultCard): string {
    return item.id;
  }

  ownerTrack(_: number, owner: CollectionOwnerRead): string {
    return owner.user_id;
  }

  tradeTrack(_: number, trade: TradeOfferRead): string {
    return trade.id;
  }

  tradeItems(trade: TradeOfferRead, side: TradeSide): TradeOfferItemRead[] {
    return trade.items.filter((item) => item.side === side);
  }

  tradeItemLabel(item: TradeOfferItemRead): string {
    const collectionItem = item.collection_item;
    if (!collectionItem) {
      return 'Collection item';
    }
    return `${this.collectionTitle({ ...collectionItem, thumbnail_url: null })} · ${collectionItem.rarity_tier_at_acquisition}`;
  }

  tradeDateLabel(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  }

  isCancellingTrade(trade: TradeOfferRead): boolean {
    return this.cancellingTradeIds().has(trade.id);
  }

  pullTitle(item: PullResultCard): string {
    return item.was_duplicate ? 'Duplicate pull' : 'New pull';
  }

  pullMeta(item: PullResultCard): string[] {
    return item.upgrade_material_granted > 0
      ? [item.was_duplicate ? 'Duplicate' : 'New', `+${item.upgrade_material_granted} XP`]
      : [item.was_duplicate ? 'Duplicate' : 'New'];
  }

  inspectPullResult(item: PullResultCard): void {
    this.openCardInspector({
      id: item.id,
      mediaId: item.media_id,
      rarity: item.rarity_tier,
      title: this.pullTitle(item),
      thumbnailUrl: item.thumbnail_url,
      contextLabel: 'Pull result',
    });
  }

  inspectCollectionItem(item: GachaCollectionCard): void {
    this.openCardInspector(this.collectionInspectorCard(item, 'Your collection'));
  }

  inspectViewedCollectionItem(item: GachaCollectionCard): void {
    const owner = this.selectedOwner();
    this.openCardInspector(this.collectionInspectorCard(
      item,
      owner ? `${owner.username}'s collection` : 'Collector collection',
    ));
  }

  inspectOfferedCollectionItem(item: GachaCollectionCard): void {
    this.openCardInspector(this.collectionInspectorCard(item, 'Your offer'));
  }

  nextDailyLabel(value: string | null): string {
    if (!value) {
      return 'Available now';
    }

    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  }

  private canPull(cost: number): boolean {
    return !this.pullLoading() && !this.animationActive() && this.balanceValue() >= cost;
  }

  private discardPullValue(item: CollectionItemRead): number {
    return PULL_PAYOUT_BY_RARITY[item.rarity_tier_at_acquisition] * item.level;
  }

  private applyDailyClaim(response: GachaDailyClaimResponse): void {
    this.balance.update((current) => current
      ? {
          ...current,
          balance: response.balance,
          total_claimed: current.total_claimed + response.claimed,
          daily_claim_available: response.daily_claim_available,
          next_daily_claim_at: response.next_daily_claim_at,
        }
      : current);
    this.stats.update((current) => current
      ? {
          ...current,
          currency_balance: response.balance,
          daily_claim_available: response.daily_claim_available,
          next_daily_claim_at: response.next_daily_claim_at,
        }
      : current);
  }

  private applyPullBalance(pull: GachaPullRead): void {
    if (pull.currency_balance == null) {
      return;
    }

    const currencyBalance = pull.currency_balance;
    this.balance.update((current) => current
      ? { ...current, balance: currencyBalance, total_spent: current.total_spent + pull.currency_spent }
      : current);
    this.stats.update((current) => current ? { ...current, currency_balance: currencyBalance } : current);
  }

  private applyDiscardResult(currencyBalance: number, item: CollectionItemRead | null): void {
    this.balance.update((current) => current ? { ...current, balance: currencyBalance } : current);
    this.stats.update((current) => current ? { ...current, currency_balance: currencyBalance } : current);
    if (item) {
      this.collection.update((current) => current.map((card) => (
        card.id === item.id ? { ...item, thumbnail_url: card.thumbnail_url } : card
      )));
      return;
    }
  }

  private runAnimation(): void {
    this.clearTimers();
    this.animationState.set('summoning');

    if (this.reducedMotion) {
      this.queueStage('reveal', 120);
      this.queueStage('complete', 360);
      return;
    }

    const rareDelay = this.rareReveal() ? 450 : 0;
    this.queueStage('charging', 900);
    this.queueStage('reveal', 1900 + rareDelay);
    this.queueStage('complete', 3100 + rareDelay);
  }

  private queueStage(stage: AnimationState, delayMs: number): void {
    this.timers.push(setTimeout(() => this.animationState.set(stage), delayMs));
  }

  private clearTimers(): void {
    while (this.timers.length) {
      const timer = this.timers.pop();
      if (timer) clearTimeout(timer);
    }
  }

  private toResultCards(items: GachaPullItemRead[]): PullResultCard[] {
    return [...items]
      .sort((left, right) => left.position - right.position)
      .map((item) => ({ ...item, thumbnail_url: null }));
  }

  private toCollectionCards(items: CollectionItemRead[]): GachaCollectionCard[] {
    return items.map((item) => ({ ...item, thumbnail_url: null }));
  }

  private parseFilterList(value: string): string[] | undefined {
    const terms = value
      .split(',')
      .map((term) => term.trim())
      .filter(Boolean);
    return terms.length > 0 ? terms : undefined;
  }

  private isTradeableItem(item: CollectionItemRead): boolean {
    return item.tradeable && !item.locked;
  }

  private openCardInspector(card: GachaInspectorCard): void {
    this.dialog.open(GachaCardInspectorDialogComponent, {
      data: { card },
      width: 'min(1000px, 94vw)',
      maxWidth: '94vw',
      maxHeight: '92vh',
      autoFocus: false,
      panelClass: 'gacha-card-inspector-panel',
    });
  }

  private collectionInspectorCard(item: GachaCollectionCard, contextLabel: string): GachaInspectorCard {
    return {
      id: item.id,
      mediaId: item.media_id,
      rarity: item.rarity_tier_at_acquisition,
      title: this.collectionTitle(item),
      thumbnailUrl: item.thumbnail_url,
      contextLabel,
      level: item.level,
      copiesPulled: item.copies_pulled,
      locked: item.locked,
      tradeable: item.tradeable,
      acquiredAt: item.acquired_at,
      updatedAt: item.updated_at,
      tags: item.media?.tags ?? [],
      characters: this.collectionEntityNames(item, MediaEntityType.CHARACTER),
      series: this.collectionEntityNames(item, MediaEntityType.SERIES),
    };
  }

  private collectionTitle(item: GachaCollectionCard): string {
    const media = item.media;
    if (!media) return item.media_id;

    const characters = this.displayMetadataNames(this.collectionEntityNames(item, MediaEntityType.CHARACTER));
    if (characters.length > 0) {
      return characters.slice(0, 2).join(', ');
    }

    const series = this.displayMetadataNames(this.collectionEntityNames(item, MediaEntityType.SERIES));
    if (series.length > 0) {
      return series.slice(0, 2).join(', ');
    }

    return this.displayMetadataNames(media.tags).slice(0, 2).join(', ') || 'Untitled collection item';
  }

  private collectionEntityNames(item: GachaCollectionCard, type: MediaEntityType): string[] {
    return item.media?.entities
      .filter((entity) => entity.entity_type === type)
      .map((entity) => entity.name)
      .filter((name, index, names) => names.indexOf(name) === index) ?? [];
  }

  private displayMetadataNames(values: readonly string[]): string[] {
    return values
      .map((value) => formatMetadataName(value))
      .filter((value) => value.length > 0);
  }

  private toggleSelection(selection: WritableSignal<ReadonlySet<string>>, itemId: string): void {
    selection.update((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  private loadPullThumbnails(items: GachaPullItemRead[]): void {
    for (const item of items) {
      this.mediaService.getThumbnailUrl(item.media_id).pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of(null)),
      ).subscribe((url) => {
        if (!url) return;
        this.pullResults.update((current) => current.map((card) => (
          card.id === item.id ? { ...card, thumbnail_url: url } : card
        )));
      });
    }
  }

  private loadCollectionThumbnails(items: CollectionItemRead[]): void {
    for (const item of items) {
      this.mediaService.getThumbnailUrl(item.media_id).pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of(null)),
      ).subscribe((url) => {
        if (!url) return;
        this.collection.update((current) => current.map((card) => (
          card.id === item.id ? { ...card, thumbnail_url: url } : card
        )));
      });
    }
  }

  private loadViewedCollectionThumbnails(items: CollectionItemRead[]): void {
    for (const item of items) {
      this.mediaService.getThumbnailUrl(item.media_id).pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of(null)),
      ).subscribe((url) => {
        if (!url) return;
        this.viewedCollection.update((current) => current.map((card) => (
          card.id === item.id ? { ...card, thumbnail_url: url } : card
        )));
      });
    }
  }

  private loadTradeOwnCollectionThumbnails(items: CollectionItemRead[]): void {
    for (const item of items) {
      this.mediaService.getThumbnailUrl(item.media_id).pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of(null)),
      ).subscribe((url) => {
        if (!url) return;
        this.tradeOwnCollection.update((current) => current.map((card) => (
          card.id === item.id ? { ...card, thumbnail_url: url } : card
        )));
      });
    }
  }

  private highestTier(items: Pick<GachaPullItemRead, 'rarity_tier'>[]): RarityTier | null {
    return items.reduce<RarityTier | null>((highest, item) => {
      if (!highest) return item.rarity_tier;
      return (RARITY_RANK.get(item.rarity_tier) ?? 0) > (RARITY_RANK.get(highest) ?? 0)
        ? item.rarity_tier
        : highest;
    }, null);
  }
}
