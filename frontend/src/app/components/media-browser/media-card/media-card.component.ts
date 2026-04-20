import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MediaRead, MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../../models/media';
import { BadgeVisibilityService } from '../../../services/badge-visibility.service';
import { MediaService } from '../../../services/media.service';

@Component({
  selector: 'zukan-media-card',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './media-card.component.html',
  styleUrl: './media-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaCardComponent {
  private static readonly LONG_PRESS_DELAY_MS = 1000;
  private static readonly LONG_PRESS_MOVE_TOLERANCE_PX = 12;

  readonly media = input.required<MediaRead>();
  readonly selectable = input(false);
  readonly selectedState = input(false, { alias: 'selected' });
  readonly selectionMode = input(false);
  readonly showFavorite = input(false);
  readonly showPublicBadge = input(true);
  readonly activated = output<MediaRead>();
  readonly selectionToggled = output<MediaRead>();
  readonly favoriteToggled = output<MediaRead>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('card');
  private readonly videoPreview = viewChild<ElementRef<HTMLVideoElement>>('videoPreview');
  private readonly mediaService = inject(MediaService);
  private readonly badgeVisibility = inject(BadgeVisibilityService);

  readonly previewUrl = signal<string | null>(null);
  readonly animatedPreviewUrl = signal<string | null>(null);
  readonly loading = signal(false);
  readonly hovered = signal(false);
  readonly focused = signal(false);
  readonly visible = signal(false);
  readonly failed = signal(false);

  readonly aspectRatio = computed(() => {
    const media = this.media();
    const width = media.metadata.width ?? 1;
    const height = media.metadata.height ?? 1;
    return Math.max(width, 1) / Math.max(height, 1);
  });

  readonly mediaIcon = computed(() => {
    switch (this.media().media_type) {
      case MediaType.GIF:
        return 'gif_box';
      case MediaType.VIDEO:
        return 'videocam';
      default:
        return null;
    }
  });

  readonly isPublic = computed(() => this.media().visibility === MediaVisibility.PUBLIC);
  readonly isNsfw = computed(() => this.media().is_nsfw && !this.badgeVisibility.hideNsfw());
  readonly isSensitive = computed(() => this.media().is_sensitive && !this.badgeVisibility.hideSensitive());
  readonly isProcessing = computed(() => {
    const media = this.media();
    const taggingInProgress = media.tagging_status === TaggingStatus.PENDING
      || media.tagging_status === TaggingStatus.PROCESSING;

    if (media.media_type === MediaType.VIDEO) {
      return taggingInProgress
        || media.poster_status === ProcessingStatus.PENDING
        || media.poster_status === ProcessingStatus.PROCESSING;
    }

    return taggingInProgress
      || media.thumbnail_status === ProcessingStatus.PENDING
      || media.thumbnail_status === ProcessingStatus.PROCESSING;
  });
  readonly interactionDisabled = computed(() => this.media().client_is_optimistic === true && this.isProcessing());

  readonly displayUrl = computed(() => {
    if (this.media().client_preview_url) {
      return this.media().client_preview_url;
    }

    if (this.hovered() && this.animatedPreviewUrl()) {
      return this.animatedPreviewUrl();
    }
    return this.previewUrl();
  });

  readonly showVideoPreview = computed(() =>
    this.media().media_type === MediaType.VIDEO && this.hovered() && !!this.animatedPreviewUrl(),
  );
  readonly showSelectionControl = computed(() =>
    this.selectable() && (this.selectionMode() || this.hovered()),
  );
  readonly isFavorited = computed(() => this.media().is_favorited);
  readonly favoriteCount = computed(() => this.media().favorite_count ?? 0);
  readonly showPublicOverlay = computed(() => this.isPublic() && this.showPublicBadge() && (this.hovered() || this.focused()));
  readonly showFavoriteOverlay = computed(() => this.showFavorite() && (this.hovered() || this.focused()));

  private previewObserver?: IntersectionObserver;
  private hasRequestedPreview = false;
  private hasRequestedAnimatedPreview = false;
  private lastMediaId: string | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressedPointerId: number | null = null;
  private pressStartX = 0;
  private pressStartY = 0;
  private suppressNextClick = false;

  constructor() {
    effect(() => {
      const media = this.media();

      if (media.id !== this.lastMediaId) {
        this.lastMediaId = media.id;
        this.hasRequestedPreview = false;
        this.hasRequestedAnimatedPreview = false;
        this.previewUrl.set(null);
        this.animatedPreviewUrl.set(null);
        this.failed.set(false);
        this.loading.set(false);
      }

      if (this.visible()) {
        untracked(() => this.loadPrimaryPreview());
      }
    });

    effect(() => {
      if (!this.showVideoPreview()) {
        return;
      }

      const element = this.videoPreview()?.nativeElement;
      if (!element) {
        return;
      }

      queueMicrotask(() => this.safePlay(element));
    });
  }

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.visible.set(true);
      this.loadPrimaryPreview();
      return;
    }

    this.previewObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some(entry => entry.isIntersecting)) {
          return;
        }
        this.visible.set(true);
        this.loadPrimaryPreview();
        this.previewObserver?.disconnect();
      },
      { rootMargin: '800px 0px' },
    );
    this.previewObserver.observe(this.host().nativeElement);
  }

  ngOnDestroy(): void {
    this.previewObserver?.disconnect();
    this.clearLongPress();
  }

  onSelect(): void {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }

    if (this.interactionDisabled()) {
      return;
    }

    if (this.selectionMode()) {
      this.selectionToggled.emit(this.media());
      return;
    }

    this.activated.emit(this.media());
  }

  onSelectionToggle(event: Event): void {
    event.stopPropagation();
    if (this.interactionDisabled()) {
      return;
    }
    this.selectionToggled.emit(this.media());
  }

  onCardKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.onSelect();
  }

  onFavoriteToggle(event: Event): void {
    event.stopPropagation();
    this.clearLongPress();
    if (this.interactionDisabled()) {
      return;
    }
    this.favoriteToggled.emit(this.media());
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.shouldHandleLongPress(event)) {
      return;
    }

    this.clearLongPress();
    this.pressedPointerId = event.pointerId;
    this.pressStartX = event.clientX;
    this.pressStartY = event.clientY;
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      this.pressedPointerId = null;
      this.suppressNextClick = true;
      this.selectionToggled.emit(this.media());
    }, MediaCardComponent.LONG_PRESS_DELAY_MS);
  }

  onPointerMove(event: PointerEvent): void {
    if (this.pressedPointerId !== event.pointerId) {
      return;
    }

    const deltaX = Math.abs(event.clientX - this.pressStartX);
    const deltaY = Math.abs(event.clientY - this.pressStartY);
    if (
      deltaX > MediaCardComponent.LONG_PRESS_MOVE_TOLERANCE_PX ||
      deltaY > MediaCardComponent.LONG_PRESS_MOVE_TOLERANCE_PX
    ) {
      this.clearLongPress();
    }
  }

  onPointerRelease(event: PointerEvent): void {
    if (this.pressedPointerId !== event.pointerId) {
      return;
    }

    this.clearLongPress();
  }

  onHover(active: boolean): void {
    this.hovered.set(active);
    if (active) {
      this.loadAnimatedPreview();
    }
  }

  onFocusIn(): void {
    this.focused.set(true);
  }

  onFocusOut(event: FocusEvent): void {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && this.host().nativeElement.contains(nextTarget)) {
      return;
    }

    this.focused.set(false);
  }

  private shouldHandleLongPress(event: PointerEvent): boolean {
    if (!this.selectable() || this.selectionMode() || this.interactionDisabled()) {
      return false;
    }

    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
      return false;
    }

    const target = event.target;
    return !(target instanceof HTMLElement) || target.closest('button, a, input, textarea, select') == null;
  }

  private clearLongPress(): void {
    if (this.longPressTimer != null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.pressedPointerId = null;
  }

  private loadPrimaryPreview(): void {
    if (this.hasRequestedPreview || this.previewUrl() || this.failed()) {
      return;
    }

    const request = this.primaryPreviewRequest();
    if (!request) {
      return;
    }

    this.hasRequestedPreview = true;
    this.loading.set(true);
    request
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (url) => {
          this.previewUrl.set(url);
          this.loading.set(false);
        },
        error: () => {
          this.failed.set(true);
          this.loading.set(false);
        },
      });
  }

  private loadAnimatedPreview(): void {
    if (!this.visible() || this.hasRequestedAnimatedPreview || this.animatedPreviewUrl()) {
      return;
    }

    const media = this.media();
    if (media.media_type !== MediaType.GIF && media.media_type !== MediaType.VIDEO) {
      return;
    }

    this.hasRequestedAnimatedPreview = true;
    this.mediaService
      .getFileUrl(media.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (url) => {
          this.animatedPreviewUrl.set(url);
        },
      });
  }

  private primaryPreviewRequest() {
    const media = this.media();

    if (media.media_type === MediaType.VIDEO && media.poster_status === ProcessingStatus.DONE) {
      return this.mediaService.getPosterUrl(media.id);
    }

    if (media.thumbnail_status === ProcessingStatus.DONE) {
      return this.mediaService.getThumbnailUrl(media.id);
    }

    if (media.media_type === MediaType.GIF) {
      return this.mediaService.getFileUrl(media.id);
    }

    return null;
  }

  private safePlay(element: HTMLVideoElement): void {
    const playResult = element.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => {});
    }
  }
}
