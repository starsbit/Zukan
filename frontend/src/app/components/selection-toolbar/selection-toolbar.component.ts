import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-selection-toolbar',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './selection-toolbar.component.html',
  styleUrl: './selection-toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SelectionToolbarComponent {
  @Input() selectedCount = 0;
  @Input() clearButtonAriaLabel = 'Clear selection';
  @Input() ariaLabel = 'Selection toolbar';

  @Output() readonly clearRequested = new EventEmitter<void>();
}
