import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CollectionItemRead } from '../../../models/collection';
import { RarityTier } from '../../../models/gacha';
import { MediaEntityType } from '../../../models/relations';
import { formatMetadataName } from '../../../utils/media-display.utils';
import { GachaDisplayCardComponent } from '../gacha-display-card/gacha-display-card.component';

export interface GachaCollectionCard extends CollectionItemRead {
  thumbnail_url: string | null;
}

@Component({
  selector: 'zukan-gacha-collection-browser',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    GachaDisplayCardComponent,
  ],
  templateUrl: './gacha-collection-browser.component.html',
  styleUrl: './gacha-collection-browser.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GachaCollectionBrowserComponent {
  readonly items = input<readonly GachaCollectionCard[]>([]);
  readonly rarityTiers = input<readonly RarityTier[]>([]);
  readonly rarityFilter = input<RarityTier | null>(null);
  readonly duplicatesOnly = input(false);
  readonly tagFilter = input('');
  readonly characterFilter = input('');
  readonly seriesFilter = input('');
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly hideNsfw = input(false);
  readonly hideSensitive = input(false);
  readonly showFilters = input(true);
  readonly selectable = input(false);
  readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  readonly selectLabel = input('Select');
  readonly selectedLabel = input('Selected');
  readonly discardable = input(false);
  readonly discardLoadingIds = input<ReadonlySet<string>>(new Set<string>());
  readonly discardPreview = input<(item: GachaCollectionCard) => number>(() => 0);
  readonly canDiscardItem = input<(item: GachaCollectionCard) => boolean>(() => true);
  readonly emptyMessage = input('No collection items match these filters.');
  readonly ariaLabel = input('Collection items');
  readonly canSelectItem = input<(item: GachaCollectionCard) => boolean>(() => true);

  readonly rarityFilterChange = output<RarityTier | null>();
  readonly duplicatesOnlyChange = output<boolean>();
  readonly tagFilterChange = output<string>();
  readonly characterFilterChange = output<string>();
  readonly seriesFilterChange = output<string>();
  readonly filtersCleared = output<void>();
  readonly itemToggled = output<GachaCollectionCard>();
  readonly itemInspected = output<GachaCollectionCard>();
  readonly itemDiscarded = output<GachaCollectionCard>();

  readonly visibleItems = computed(() => this.items().filter((item) => {
    if (this.hideNsfw() && item.media?.is_nsfw) return false;
    if (this.hideSensitive() && item.media?.is_sensitive) return false;
    return true;
  }));

  readonly hasItems = computed(() => this.visibleItems().length > 0);

  trackItem(_: number, item: GachaCollectionCard): string {
    return item.id;
  }

  rarityClass(tier: RarityTier): string {
    return `rarity-${tier.toLowerCase()}`;
  }

  title(item: GachaCollectionCard): string {
    const media = item.media;
    if (!media) return item.media_id;

    const characters = this.entityNames(item, MediaEntityType.CHARACTER);
    if (characters.length > 0) {
      return this.displayMetadataNames(characters).slice(0, 2).join(', ');
    }

    const series = this.entityNames(item, MediaEntityType.SERIES);
    if (series.length > 0) {
      return this.displayMetadataNames(series).slice(0, 2).join(', ');
    }

    return this.displayMetadataNames(media.tags).slice(0, 2).join(', ') || 'Untitled collection item';
  }

  meta(item: GachaCollectionCard): string[] {
    return [this.copyLabel(item.copies_pulled)];
  }

  isSelected(item: GachaCollectionCard): boolean {
    return this.selectedIds().has(item.id);
  }

  itemDisabled(item: GachaCollectionCard): boolean {
    return this.selectable() && !this.canSelectItem()(item);
  }

  discardDisabled(item: GachaCollectionCard): boolean {
    return this.discardLoadingIds().has(item.id) || !this.canDiscardItem()(item);
  }

  selectionLabel(item: GachaCollectionCard): string {
    return this.isSelected(item) ? this.selectedLabel() : this.selectLabel();
  }

  discardLabel(item: GachaCollectionCard): string {
    return `Destroy · +${this.discardPreview()(item)} Pulls`;
  }

  inspect(item: GachaCollectionCard): void {
    this.itemInspected.emit(item);
  }

  toggleSelection(event: Event, item: GachaCollectionCard): void {
    event.stopPropagation();
    if (this.itemDisabled(item)) {
      return;
    }
    this.itemToggled.emit(item);
  }

  discard(event: Event, item: GachaCollectionCard): void {
    event.stopPropagation();
    if (this.discardDisabled(item)) {
      return;
    }
    this.itemDiscarded.emit(item);
  }

  private entityNames(item: GachaCollectionCard, type: MediaEntityType): string[] {
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

  private copyLabel(value: number): string {
    return value === 1 ? '1 copy' : `${value} copies`;
  }
}
