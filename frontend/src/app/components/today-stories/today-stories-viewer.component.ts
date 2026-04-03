import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { fromEvent } from 'rxjs';
import { MediaType } from '../../models/media';
import { TodayStoriesViewerData } from '../../models/today-stories';
import {
  IMAGE_STORY_DURATION_MS,
} from '../../utils/today-stories.utils';
import { MediaService } from '../../services/media.service';
import { TodayStoriesStore } from './today-stories.store';

@Component({
  selector: 'zukan-today-stories-viewer',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './today-stories-viewer.component.html',
  styleUrl: './today-stories-viewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TodayStoriesViewerComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef<TodayStoriesViewerComponent>);
  protected readonly data = inject<TodayStoriesViewerData>(MAT_DIALOG_DATA);
  private readonly mediaService = inject(MediaService);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly store = inject(TodayStoriesStore);
  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoElement');

  readonly groupItems = computed(() =>
    this.store.groups().find((group) => group.yearsAgo === this.data.yearsAgo)?.items ?? [],
  );
  readonly activeIndex = signal(this.data.initialIndex);
  readonly mediaUrl = signal<string | null>(null);
  readonly loading = signal(true);
  readonly pausedByHold = signal(false);
  readonly pausedByVisibility = signal(document.visibilityState !== 'visible');
  readonly pausedByPlayback = signal(false);
  readonly mediaBlocked = signal(false);
  readonly togglingFavorite = signal(false);
  readonly activeDurationMs = signal(IMAGE_STORY_DURATION_MS);
  readonly elapsedMs = signal(0);

  readonly activeItem = computed(() => this.groupItems()[this.activeIndex()] ?? null);
  readonly isVideo = computed(() => this.activeItem()?.media_type === MediaType.VIDEO);
  readonly canGoBack = computed(() => this.activeIndex() > 0);
  readonly canGoForward = computed(() => this.activeIndex() < this.groupItems().length - 1);
  readonly isPaused = computed(() =>
    this.loading()
    || this.pausedByHold()
    || this.pausedByVisibility()
    || this.pausedByPlayback()
    || this.mediaBlocked(),
  );
  readonly segmentStates = computed(() =>
    this.groupItems().map((item, index) => ({
      id: item.id,
      isCompleted: index < this.activeIndex(),
      isActive: index === this.activeIndex(),
      isPending: index > this.activeIndex(),
      progress: this.segmentProgress(index),
    })),
  );

  private activeUrl: string | null = null;
  private activeMediaId: string | null = null;
  private suppressNextVideoPauseEvent = false;
  private animationFrameId: number | null = null;
  private lastProgressFrameAt: number | null = null;

  constructor() {
    effect(() => {
      const item = this.activeItem();
      if (!item) {
        if (this.groupItems().length === 0) {
          this.dialogRef.close();
        }
        return;
      }

      if (item.id === this.activeMediaId) {
        return;
      }

      this.activeMediaId = item.id;
      this.loadActiveMedia(item.id);
    });

    effect(() => {
      const item = this.activeItem();
      const paused = this.isPaused();
      const video = this.videoRef()?.nativeElement;
      if (!item) {
        return;
      }

      if (paused) {
        this.stopProgressLoop();
        if (video) {
          this.suppressNextVideoPauseEvent = true;
          video.pause();
        }
        return;
      }

      if (item.media_type === MediaType.VIDEO && video) {
        void video.play().catch(() => {
          this.mediaBlocked.set(true);
        });
        return;
      }

      this.startProgressLoop();
    });

    fromEvent(document, 'visibilitychange')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.pausedByVisibility.set(document.visibilityState !== 'visible');
      });
  }

  ngOnDestroy(): void {
    this.stopProgressLoop();
    this.revokeActiveUrl();
  }

  close(): void {
    this.dialogRef.close();
  }

  previous(): void {
    if (!this.canGoBack()) {
      return;
    }

    this.activeIndex.update((index) => index - 1);
  }

  next(): void {
    if (this.canGoForward()) {
      this.activeIndex.update((index) => index + 1);
      return;
    }

    this.close();
  }

  onHoldStart(event: PointerEvent): void {
    if (this.shouldIgnoreStoryInteractionTarget(event.target)) {
      return;
    }

    this.pausedByHold.set(true);
  }

  onHoldEnd(event: PointerEvent): void {
    if (this.shouldIgnoreStoryInteractionTarget(event.target)) {
      return;
    }

    this.pausedByHold.set(false);
  }

  toggleFavorite(): void {
    const item = this.activeItem();
    if (!item || this.togglingFavorite()) {
      return;
    }

    this.togglingFavorite.set(true);
    this.store.toggleFavorite(item)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.togglingFavorite.set(false);
          const nextItems = this.groupItems();
          const nextIndex = nextItems.findIndex((candidate) => candidate.id === updated.id);

          if (nextItems.length === 0) {
            this.close();
            return;
          }

          if (nextIndex === -1) {
            this.activeIndex.set(Math.min(this.activeIndex(), nextItems.length - 1));
          }
        },
        error: () => {
          this.togglingFavorite.set(false);
          this.snackBar.open('Could not update favorite right now.', 'Close', { duration: 3500 });
        },
      });
  }

  onVideoLoadedMetadata(): void {
    const video = this.videoRef()?.nativeElement;
    if (!video) {
      return;
    }

    this.pausedByPlayback.set(false);
    this.mediaBlocked.set(false);
    this.elapsedMs.set(0);
    this.activeDurationMs.set(Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 1);
  }

  onVideoEnded(): void {
    this.pausedByPlayback.set(false);
    this.stopProgressLoop();
    this.elapsedMs.set(this.activeDurationMs());
    this.next();
  }

  onVideoPause(): void {
    if (this.suppressNextVideoPauseEvent) {
      this.suppressNextVideoPauseEvent = false;
      return;
    }

    this.pausedByPlayback.set(true);
  }

  onVideoPlay(): void {
    this.suppressNextVideoPauseEvent = false;
    this.pausedByPlayback.set(false);
  }

  onVideoTimeUpdate(): void {
    const video = this.videoRef()?.nativeElement;
    if (!video) {
      return;
    }

    this.elapsedMs.set(video.currentTime * 1000);
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.previous();
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.next();
    }
  }

  private loadActiveMedia(id: string): void {
    this.loading.set(true);
    this.pausedByPlayback.set(false);
    this.mediaBlocked.set(false);
    this.activeDurationMs.set(IMAGE_STORY_DURATION_MS);
    this.stopProgressLoop();
    this.lastProgressFrameAt = null;
    this.elapsedMs.set(0);
    this.revokeActiveUrl();

    this.mediaService.getFileUrl(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (url) => {
          this.activeUrl = url;
          this.mediaUrl.set(url);
          this.loading.set(false);

          if (this.isVideo() && this.videoRef()?.nativeElement) {
            void this.videoRef()!.nativeElement.play().catch(() => {
              this.mediaBlocked.set(true);
            });
          }
        },
        error: () => {
          this.loading.set(false);
          this.mediaBlocked.set(true);
          this.activeMediaId = null;
          this.snackBar.open('Could not load this story.', 'Close', { duration: 3500 });
        },
      });
  }

  private startProgressLoop(): void {
    if (this.isVideo()) {
      return;
    }

    if (this.animationFrameId != null) {
      return;
    }

    this.lastProgressFrameAt = performance.now();
    this.animationFrameId = window.requestAnimationFrame((time) => this.advanceProgress(time));
  }

  private advanceProgress(timestamp: number): void {
    if (this.isPaused() || this.isVideo()) {
      this.stopProgressLoop();
      return;
    }

    const lastFrameAt = this.lastProgressFrameAt ?? timestamp;
    const nextElapsed = this.elapsedMs() + (timestamp - lastFrameAt);
    this.lastProgressFrameAt = timestamp;

    if (nextElapsed >= this.activeDurationMs()) {
      this.stopProgressLoop();
      this.elapsedMs.set(this.activeDurationMs());
      this.next();
      return;
    }

    this.elapsedMs.set(nextElapsed);
    this.animationFrameId = window.requestAnimationFrame((time) => this.advanceProgress(time));
  }

  private stopProgressLoop(): void {
    if (this.animationFrameId != null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.lastProgressFrameAt = null;
  }

  private revokeActiveUrl(): void {
    if (this.activeUrl) {
      URL.revokeObjectURL(this.activeUrl);
      this.activeUrl = null;
    }

    this.mediaUrl.set(null);
  }

  private shouldIgnoreStoryInteractionTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (target.closest('[data-story-control]')) {
      return true;
    }

    if (target.closest('video') || target.closest('img')) {
      return true;
    }

    return false;
  }

  private segmentProgress(index: number): number {
    if (index < this.activeIndex()) {
      return 100;
    }

    if (index > this.activeIndex()) {
      return 0;
    }

    return Math.max(0, Math.min(100, (this.elapsedMs() / Math.max(1, this.activeDurationMs())) * 100));
  }
}
