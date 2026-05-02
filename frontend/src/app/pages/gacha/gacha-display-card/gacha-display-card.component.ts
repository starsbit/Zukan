import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { EMPTY, catchError } from 'rxjs';
import { LazyViewportDirective } from '../../../directives/lazy-viewport.directive';
import { RarityTier } from '../../../models/gacha';
import { MediaType } from '../../../models/media';
import { MediaService } from '../../../services/media.service';
import { GachaRarityParticlesComponent } from '../gacha-rarity-particles/gacha-rarity-particles.component';

@Component({
  selector: 'zukan-gacha-display-card',
  imports: [MatIconModule, GachaRarityParticlesComponent, LazyViewportDirective],
  templateUrl: './gacha-display-card.component.html',
  styleUrl: './gacha-display-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GachaDisplayCardComponent {
  readonly rarity = input.required<RarityTier>();
  readonly mediaId = input<string | null>(null);
  readonly mediaType = input<MediaType | null>(null);
  readonly thumbnailUrl = input<string | null>(null);
  readonly title = input<string | null>(null);
  readonly meta = input<readonly string[]>([]);
  readonly level = input<number | null>(null);
  readonly revealed = input(true);
  readonly revealIndex = input(0);
  readonly featured = input(false);
  readonly compact = input(false);

  readonly starSlots = [1, 2, 3, 4, 5] as const;

  private readonly pointerX = signal(50);
  private readonly pointerY = signal(50);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mediaService = inject(MediaService);
  private lastMediaId: string | null = null;
  private hasRequestedPreview = false;

  readonly visible = signal(false);
  readonly lazyPreviewUrl = signal<string | null>(null);
  readonly failedPreview = signal(false);
  readonly rarityClass = computed(() => `rarity-${this.rarity().toLowerCase()}`);
  readonly normalizedLevel = computed(() => {
    const level = this.level();
    if (level == null || !Number.isFinite(level)) {
      return null;
    }
    return Math.min(5, Math.max(1, Math.round(level)));
  });
  readonly starLevelClass = computed(() => {
    const level = this.normalizedLevel();
    return level == null ? '' : `star-level-${level}`;
  });
  readonly cardParticlesActive = computed(() => {
    const rarity = this.rarity();
    return this.revealed() && rarity === RarityTier.UR;
  });
  readonly shinePosition = computed(() => `${this.pointerX()}% ${this.pointerY()}%`);
  readonly displayUrl = computed(() => this.thumbnailUrl() ?? this.lazyPreviewUrl());

  constructor() {
    effect(() => {
      const mediaId = this.mediaId();
      if (mediaId !== this.lastMediaId) {
        this.lastMediaId = mediaId;
        this.hasRequestedPreview = false;
        this.lazyPreviewUrl.set(null);
        this.failedPreview.set(false);
      }

      if (this.visible()) {
        untracked(() => this.loadLazyPreview());
      }
    });
  }

  onViewportVisible(): void {
    this.visible.set(true);
    this.loadLazyPreview();
  }

  onPointerMove(event: PointerEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    this.pointerX.set(Math.round(((event.clientX - rect.left) / rect.width) * 100));
    this.pointerY.set(Math.round(((event.clientY - rect.top) / rect.height) * 100));
  }

  resetPointer(): void {
    this.pointerX.set(50);
    this.pointerY.set(50);
  }

  private loadLazyPreview(): void {
    if (this.thumbnailUrl() || this.lazyPreviewUrl() || this.failedPreview() || this.hasRequestedPreview) {
      return;
    }

    const mediaId = this.mediaId();
    if (!mediaId) {
      return;
    }

    this.hasRequestedPreview = true;
    this.previewRequest(mediaId)
      .pipe(
        catchError(() => {
          this.failedPreview.set(true);
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((url) => this.lazyPreviewUrl.set(url));
  }

  private previewRequest(mediaId: string) {
    return this.mediaType() === MediaType.VIDEO
      ? this.mediaService.getPosterUrl(mediaId)
      : this.mediaService.getThumbnailUrl(mediaId);
  }
}
