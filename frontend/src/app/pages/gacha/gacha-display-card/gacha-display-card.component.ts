import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RarityTier } from '../../../models/gacha';

@Component({
  selector: 'zukan-gacha-display-card',
  imports: [MatIconModule],
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

  readonly rarityClass = computed(() => `rarity-${this.rarity().toLowerCase()}`);
}
