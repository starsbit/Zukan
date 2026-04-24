import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MetadataFilterType, NavbarSearchService } from '../../../services/navbar-search.service';
import { formatMetadataName } from '../../../utils/media-display.utils';

@Component({
  selector: 'zukan-metadata-filter-chip',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <button
      class="metadata-filter-chip"
      type="button"
      [attr.aria-label]="ariaLabel()"
      (click)="applyFilter($event)"
    >
      <mat-icon class="metadata-filter-chip__icon" aria-hidden="true">{{ icon() }}</mat-icon>
      <span class="metadata-filter-chip__label">{{ label() }}</span>
    </button>
  `,
  styleUrl: './metadata-filter-chip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetadataFilterChipComponent {
  private readonly searchService = inject(NavbarSearchService);

  readonly type = input.required<MetadataFilterType>();
  readonly value = input.required<string>();
  readonly display = input<string | null>(null);
  readonly filtered = output<void>();

  readonly label = computed(() => this.display()?.trim() || formatMetadataName(this.value()));
  readonly icon = computed(() => {
    switch (this.type()) {
      case 'tag':
        return 'sell';
      case 'character':
        return 'face';
      case 'series':
        return 'auto_stories';
    }
  });
  readonly ariaLabel = computed(() => `Filter by ${this.type()} ${this.label()}`);

  applyFilter(event: Event): void {
    event.stopPropagation();
    this.searchService.addMetadataFilter(this.type(), this.value());
    this.filtered.emit();
  }
}
