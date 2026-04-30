import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RarityTier } from '../../../models/gacha';
import { GachaRarityParticlesComponent } from '../gacha-rarity-particles/gacha-rarity-particles.component';

@Component({
  selector: 'zukan-gacha-display-card',
  imports: [MatIconModule, GachaRarityParticlesComponent],
  templateUrl: './gacha-display-card.component.html',
  styleUrl: './gacha-display-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GachaDisplayCardComponent {
  readonly rarity = input.required<RarityTier>();
  readonly thumbnailUrl = input<string | null>(null);
  readonly title = input<string | null>(null);
  readonly meta = input<readonly string[]>([]);
  readonly revealed = input(true);
  readonly revealIndex = input(0);
  readonly featured = input(false);
  readonly compact = input(false);

  private readonly pointerX = signal(50);
  private readonly pointerY = signal(50);

  readonly rarityClass = computed(() => `rarity-${this.rarity().toLowerCase()}`);
  readonly cardParticlesActive = computed(() => {
    const rarity = this.rarity();
    return this.revealed() && rarity === RarityTier.UR;
  });
  readonly shinePosition = computed(() => `${this.pointerX()}% ${this.pointerY()}%`);

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
}
