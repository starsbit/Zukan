import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { EMPTY, catchError, forkJoin, of } from 'rxjs';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { CollectionItemRead, CollectionListResponse } from '../../models/collection';
import {
  GachaCurrencyBalanceRead,
  GachaDailyClaimResponse,
  GachaPullItemRead,
  GachaPullMode,
  GachaPullRead,
  GachaStatsResponse,
  RarityTier,
} from '../../models/gacha';
import { MediaService } from '../../services/media.service';
import { UserStore } from '../../services/user.store';
import { CollectionClientService } from '../../services/web/collection-client.service';
import { GachaClientService } from '../../services/web/gacha-client.service';
import { extractApiError } from '../../utils/api-error.utils';
import { GachaDisplayCardComponent } from './gacha-display-card/gacha-display-card.component';

type AnimationState = 'idle' | 'summoning' | 'charging' | 'reveal' | 'complete';

interface PullResultCard extends GachaPullItemRead {
  thumbnail_url: string | null;
}

interface CollectionCard extends CollectionItemRead {
  thumbnail_url: string | null;
}

const SINGLE_PULL_COST = 1;
const TEN_PULL_COST = 9;
const RARITY_ORDER = [RarityTier.N, RarityTier.R, RarityTier.SR, RarityTier.SSR, RarityTier.UR];
const RARITY_RANK = new Map(RARITY_ORDER.map((tier, index) => [tier, index]));

@Component({
  selector: 'zukan-gacha-page',
  imports: [
    LayoutComponent,
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
  templateUrl: './gacha-page.component.html',
  styleUrl: './gacha-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GachaPageComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly gachaClient = inject(GachaClientService);
  private readonly collectionClient = inject(CollectionClientService);
  private readonly mediaService = inject(MediaService);
  private readonly userStore = inject(UserStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly reducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  readonly singlePullCost = SINGLE_PULL_COST;
  readonly tenPullCost = TEN_PULL_COST;
  readonly GachaPullMode = GachaPullMode;
  readonly rarityTiers = RARITY_ORDER;

  readonly balance = signal<GachaCurrencyBalanceRead | null>(null);
  readonly stats = signal<GachaStatsResponse | null>(null);
  readonly collection = signal<CollectionCard[]>([]);
  readonly collectionTotal = signal(0);
  readonly rarityFilter = signal<RarityTier | null>(null);
  readonly duplicatesOnly = signal(false);
  readonly loadingOverview = signal(false);
  readonly loadingCollection = signal(false);
  readonly collectionError = signal<string | null>(null);
  readonly claimLoading = signal(false);
  readonly pullLoading = signal(false);
  readonly animationState = signal<AnimationState>('idle');
  readonly pullResults = signal<PullResultCard[]>([]);
  readonly activePullMode = signal<GachaPullMode | null>(null);

  readonly balanceValue = computed(() => this.balance()?.balance ?? this.stats()?.currency_balance ?? 0);
  readonly dailyClaimAvailable = computed(() => this.balance()?.daily_claim_available ?? this.stats()?.daily_claim_available ?? false);
  readonly dailyClaimAmount = computed(() => this.balance()?.daily_claim_amount ?? 10);
  readonly nextDailyClaimAt = computed(() => this.balance()?.next_daily_claim_at ?? this.stats()?.next_daily_claim_at ?? null);
  readonly visibleCollection = computed(() => {
    const user = this.userStore.currentUser();
    return this.collection().filter((item) => {
      if (!user?.show_nsfw && item.media?.is_nsfw) return false;
      if (user?.show_sensitive === false && item.media?.is_sensitive) return false;
      return true;
    });
  });
  readonly hasCollection = computed(() => this.visibleCollection().length > 0);
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
      this.collection.set(response.items.map((item) => ({ ...item, thumbnail_url: null })));
      this.loadingCollection.set(false);
      this.loadCollectionThumbnails(response.items);
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
      this.snackBar.open(`Claimed ${response.claimed} currency.`, 'Close', { duration: 3500 });
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

  tierCount(tier: RarityTier): number {
    return this.stats()?.tier_counts?.[tier] ?? 0;
  }

  rarityClass(tier: RarityTier): string {
    return `rarity-${tier.toLowerCase()}`;
  }

  resultTrack(_: number, item: PullResultCard): string {
    return item.id;
  }

  collectionTrack(_: number, item: CollectionCard): string {
    return item.id;
  }

  pullTitle(item: PullResultCard): string {
    return item.was_duplicate ? 'Duplicate pull' : 'New pull';
  }

  pullMeta(item: PullResultCard): string[] {
    return item.upgrade_material_granted > 0
      ? [item.was_duplicate ? 'Duplicate' : 'New', `+${item.upgrade_material_granted} XP`]
      : [item.was_duplicate ? 'Duplicate' : 'New'];
  }

  collectionTitle(item: CollectionCard): string {
    return item.media?.filename ?? item.media_id;
  }

  collectionMeta(item: CollectionCard): string[] {
    return [
      `Lv. ${item.level}`,
      `${item.copies_pulled} copies`,
      ...(item.locked ? ['Locked'] : []),
      ...(item.tradeable ? ['Tradeable'] : []),
    ];
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

  private highestTier(items: Pick<GachaPullItemRead, 'rarity_tier'>[]): RarityTier | null {
    return items.reduce<RarityTier | null>((highest, item) => {
      if (!highest) return item.rarity_tier;
      return (RARITY_RANK.get(item.rarity_tier) ?? 0) > (RARITY_RANK.get(highest) ?? 0)
        ? item.rarity_tier
        : highest;
    }, null);
  }
}
