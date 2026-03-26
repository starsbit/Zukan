import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { MediaDetail } from '../../models/api';
import { MediaTagEditorComponent, MediaTagEditorDraft } from '../media-tag-editor/media-tag-editor.component';
import { MediaClientService } from '../../services/web/media-client.service';
import { createObjectUrl, revokeObjectUrl } from '../../utils/object-url.utils';

export interface UploadReviewCandidate {
  media: MediaDetail;
  issue: 'tagging_failed' | 'missing_character';
}

export interface UploadReviewDialogResult {
  action: 'save' | 'skip' | 'skip_all';
  characterName?: string | null;
  tags?: string[];
}

@Component({
  selector: 'app-upload-review-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatIconModule,
    MatProgressSpinnerModule,
    MediaTagEditorComponent
  ],
  templateUrl: './upload-review-dialog.component.html',
  styleUrl: './upload-review-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UploadReviewDialogComponent implements OnInit, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly mediaClient = inject(MediaClientService);
  private readonly dialogRef = inject(MatDialogRef<UploadReviewDialogComponent, UploadReviewDialogResult>);

  readonly data = inject<UploadReviewCandidate>(MAT_DIALOG_DATA);

  mediaUrl: string | null = null;
  loading = true;
  failed = false;
  draft: MediaTagEditorDraft = {
    characterName: this.data.media.entities?.find(e => e.entity_type === 'character')?.name ?? null,
    tags: [...this.data.media.tags]
  };

  ngOnInit(): void {
    this.mediaClient.getMediaFile(this.data.media.id).subscribe({
      next: (blob) => {
        this.mediaUrl = createObjectUrl(blob);
        this.loading = false;
        this.failed = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.failed = true;
        this.cdr.markForCheck();
      }
    });
  }

  ngOnDestroy(): void {
    this.mediaUrl = revokeObjectUrl(this.mediaUrl);
  }

  updateDraft(draft: MediaTagEditorDraft): void {
    this.draft = draft;
  }

  save(): void {
    this.dialogRef.close({
      action: 'save',
      characterName: this.draft.characterName,
      tags: this.draft.tags
    });
  }

  skip(): void {
    this.dialogRef.close({ action: 'skip' });
  }

  skipAll(): void {
    this.dialogRef.close({ action: 'skip_all' });
  }

  get title(): string {
    return this.data.issue === 'tagging_failed' ? 'Tagging needs your review' : 'Add the missing character';
  }

  get warningText(): string {
    if (this.data.issue === 'tagging_failed') {
      return this.data.media.tagging_error?.trim() || 'Auto tagging failed for this image. You can name the character and adjust tags manually.';
    }

    return 'Auto tagging finished, but no character was found for this upload. Add one manually or skip this image.';
  }
}
