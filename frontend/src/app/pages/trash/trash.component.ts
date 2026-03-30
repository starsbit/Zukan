import { Component, DestroyRef, computed, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EMPTY, catchError } from 'rxjs';
import { MediaBrowserComponent } from '../../components/media-browser/media-browser.component';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { MediaListState } from '../../models/media';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { GalleryStore } from '../../services/gallery.store';
import { NavbarSearchService } from '../../services/navbar-search.service';
import { AuthStore } from '../../services/web/auth.store';

@Component({
  selector: 'zukan-trash',
  imports: [LayoutComponent, MediaBrowserComponent, MatButtonModule],
  templateUrl: './trash.component.html',
  styleUrl: './trash.component.scss',
})
export class TrashComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly authStore = inject(AuthStore);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly searchService = inject(NavbarSearchService);
  private readonly snackBar = inject(MatSnackBar);

  readonly galleryStore = inject(GalleryStore);
  readonly hasMedia = computed(() => (this.galleryStore.total() ?? this.galleryStore.items().length) > 0);

  constructor() {
    effect(() => {
      if (!this.authStore.isAuthenticated()) {
        return;
      }

      const params = {
        ...this.searchService.appliedParams(),
        state: MediaListState.TRASHED,
      };
      this.galleryStore.setParams(params);
      this.galleryStore.load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
      this.galleryStore.loadTimeline().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    });

    effect(() => {
      if (this.galleryStore.hasMore() && !this.galleryStore.loading()) {
        this.galleryStore.loadMore()
          .pipe(takeUntilDestroyed(this.destroyRef), catchError(() => EMPTY))
          .subscribe();
      }
    });
  }

  restoreSelected(ids: string[]): void {
    if (ids.length === 0) {
      return;
    }

    this.confirmDialog.open({
      title: 'Restore selected media?',
      message: `Restore ${ids.length} selected item${ids.length === 1 ? '' : 's'} from the trash?`,
      confirmLabel: 'Restore selected',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.galleryStore.batchRestore(ids).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
        this.snackBar.open(
          `Restored ${result.processed} item${result.processed === 1 ? '' : 's'}.`,
          'Close',
          { duration: 4000 },
        );
      });
    });
  }

  restoreAll(): void {
    if (!this.hasMedia()) {
      return;
    }

    this.confirmDialog.open({
      title: 'Restore all trash?',
      message: 'Restore all media currently shown by your trash filters?',
      confirmLabel: 'Restore all',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.galleryStore.restoreAllTrashed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
        this.snackBar.open(
          `Restored ${result.processed} item${result.processed === 1 ? '' : 's'} from the trash.`,
          'Close',
          { duration: 4000 },
        );
      });
    });
  }

  emptyTrash(): void {
    if (!this.hasMedia()) {
      return;
    }

    this.confirmDialog.open({
      title: 'Empty trash?',
      message: 'Permanently delete all media in the trash? This cannot be undone.',
      confirmLabel: 'Empty trash',
      tone: 'warn',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.galleryStore.emptyTrash().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        this.snackBar.open('Trash emptied.', 'Close', { duration: 4000 });
      });
    });
  }
}
