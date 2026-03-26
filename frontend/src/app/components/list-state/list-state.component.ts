import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-list-state',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './list-state.component.html',
  styleUrl: './list-state.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.display]': '"block"',
    '[style.height]': '"100%"'
  }
})
export class ListStateComponent {
  @Input({ required: true }) loading = false;
  @Input({ required: true }) hasError = false;
  @Input({ required: true }) itemCount = 0;
  @Input() containerClass = 'list-state';

  @Input() loadingMessage = 'Loading...';
  @Input() errorTitle = '';
  @Input() errorMessage = 'We could not load data.';
  @Input() emptyTitle = '';
  @Input() emptyMessage = 'No items found.';
  @Input() emptyIcon = 'imagesmode';
  @Input() loadingDiameter = 42;
  @Input() showRetry = true;

  @Output() readonly retryRequested = new EventEmitter<void>();
}
