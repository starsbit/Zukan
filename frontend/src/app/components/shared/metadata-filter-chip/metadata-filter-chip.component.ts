import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MetadataFilterType } from '../../../services/navbar-search.service';
import { formatMetadataName } from '../../../utils/media-display.utils';

export interface MetadataFilterSelection {
  type: MetadataFilterType;
  value: string;
}

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
  readonly type = input.required<MetadataFilterType>();
  readonly value = input.required<string>();
  readonly display = input<string | null>(null);
  readonly filtered = output<MetadataFilterSelection>();

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
    this.filtered.emit({ type: this.type(), value: this.value() });
  }
}
