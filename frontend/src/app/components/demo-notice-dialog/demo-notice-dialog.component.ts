import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'zukan-demo-notice-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  templateUrl: './demo-notice-dialog.component.html',
  styleUrl: './demo-notice-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoNoticeDialogComponent {
  readonly available = [
    'Browse the gallery, timeline and today stories',
    'Search by tags, characters, series and OCR text',
    'Explore similar images and albums',
    'Inspect tags, metadata and admin statistics',
  ];
  readonly disabled = ['Uploading media', 'Editing, tagging and deleting', 'Changing settings'];
}
