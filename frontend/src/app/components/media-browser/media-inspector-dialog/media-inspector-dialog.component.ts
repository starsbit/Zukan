import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { MediaDetail, MediaRead, MediaType } from '../../../models/media';
import { MediaEntityType } from '../../../models/relations';
import { CharacterSuggestion, SeriesSuggestion, TagRead } from '../../../models/tags';
import { GalleryStore } from '../../../services/gallery.store';
import { MediaService } from '../../../services/media.service';
import { TagsClientService } from '../../../services/web/tags-client.service';
import { MetadataFilterChipComponent } from '../../shared/metadata-filter-chip/metadata-filter-chip.component';
import {
  formatConfidence,
  formatDateTime,
  formatDimensions,
  formatDuration,
  formatFileSize,
  formatMetadataName,
  formatMediaType,
  formatProcessingStatus,
  formatVisibility,
  humanizeBackendLabel,
} from '../../../utils/media-display.utils';

export interface MediaInspectorDialogData {
  items: MediaRead[];
  activeMediaId: string;
}

interface InspectorField {
  label: string;
  value: string;
}

interface MetadataDraft {
  tags: string[];
  characterNames: string[];
  seriesNames: string[];
  ocrTextOverride: string;
  nsfwOverride: boolean | null;
  sensitiveOverride: boolean | null;
}

interface PointerTracker {
  clientX: number;
  clientY: number;
  pointerType: string;
}

interface GesturePoint {
  x: number;
  y: number;
}

interface FavoriteFeedback {
  favorited: boolean;
  id: number;
  x: number;
  y: number;
}

type GestureMode = 'idle' | 'swipe' | 'pan' | 'pinch';

const CLASSIFICATION_OVERRIDE_OPTIONS: ReadonlyArray<{
  label: string;
  value: boolean | null;
}> = [
  { label: 'Automatic', value: null },
  { label: 'Yes', value: true },
  { label: 'No', value: false },
];

@Component({
  selector: 'zukan-media-inspector-dialog',
  standalone: true,
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MetadataFilterChipComponent,
    ReactiveFormsModule,
  ],
  templateUrl: './media-inspector-dialog.component.html',
  styleUrl: './media-inspector-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaInspectorDialogComponent {
  private static readonly MOBILE_QUERY = '(max-width: 820px)';
  private static readonly CHROME_HIDE_DELAY_MS = 2600;
  private static readonly DOUBLE_TAP_DELAY_MS = 280;
  private static readonly FAVORITE_FEEDBACK_MS = 720;

  private readonly destroyRef = inject(DestroyRef);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly dialogRef = inject(MatDialogRef<MediaInspectorDialogComponent>);
  protected readonly data = inject<MediaInspectorDialogData>(MAT_DIALOG_DATA);
  private readonly galleryStore = inject(GalleryStore);
  private readonly mediaService = inject(MediaService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly tagsClient = inject(TagsClientService);
  private readonly zoomStage = viewChild<ElementRef<HTMLElement>>('zoomStage');
  readonly activeMediaChanged = output<string>();

  readonly items = signal<MediaRead[]>([]);
  readonly activeIndex = signal(0);
  readonly detail = signal<MediaDetail | null>(null);
  readonly mediaUrl = signal<string | null>(null);
  readonly detailError = signal('');
  readonly fileError = signal('');
  readonly loadingDetail = signal(true);
  readonly loadingFile = signal(true);
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly favoritePending = signal(false);
  readonly favoriteFeedback = signal<FavoriteFeedback | null>(null);
  readonly isMobile = signal(false);
  readonly chromeVisible = signal(true);
  readonly mobileDetailsOpen = signal(false);
  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly dragging = signal(false);
  readonly tagSuggestions = signal<TagRead[]>([]);
  readonly characterSuggestions = signal<CharacterSuggestion[]>([]);
  readonly seriesSuggestions = signal<SeriesSuggestion[]>([]);
  readonly draft = signal<MetadataDraft>({
    tags: [],
    characterNames: [],
    seriesNames: [],
    ocrTextOverride: '',
    nsfwOverride: null,
    sensitiveOverride: null,
  });

  readonly tagInputControl = new FormControl('', { nonNullable: true });
  readonly characterInputControl = new FormControl('', { nonNullable: true });
  readonly seriesInputControl = new FormControl('', { nonNullable: true });

  readonly activeItem = computed(() => this.items()[this.activeIndex()] ?? this.items()[0] ?? null);
  readonly classificationOverrideOptions = CLASSIFICATION_OVERRIDE_OPTIONS;
  readonly media = computed<MediaRead | MediaDetail>(() => this.detail() ?? this.activeItem()!);
  readonly title = computed(() => this.media().original_filename ?? this.media().filename);
  readonly isVideo = computed(() => this.media().media_type === MediaType.VIDEO);
  readonly isImage = computed(() => !this.isVideo());
  readonly hasPrevious = computed(() => this.activeIndex() > 0);
  readonly hasNext = computed(() => this.activeIndex() < this.items().length - 1);
  readonly loading = computed(() => this.loadingDetail() || this.loadingFile());
  readonly mediaLoadError = computed(() => this.fileError() || '');
  readonly detailsVisible = computed(() => !this.isMobile() || this.mobileDetailsOpen());
  readonly mobileDetailsLabel = computed(() =>
    this.mobileDetailsOpen() ? 'Hide details' : 'Details',
  );
  readonly isFavorited = computed(() => this.media().is_favorited);
  readonly favoriteCount = computed(() => this.media().favorite_count ?? 0);
  readonly imageTransform = computed(
    () => `translate(${this.panX()}px, ${this.panY()}px) scale(${this.zoom()})`,
  );
  readonly metadataFields = computed<InspectorField[]>(() => {
    const media = this.media();
    return [
      { label: 'Filename', value: media.filename },
      { label: 'Original filename', value: media.original_filename ?? '' },
      { label: 'Media type', value: formatMediaType(media.media_type) },
      { label: 'MIME type', value: media.metadata.mime_type ?? '' },
      { label: 'Dimensions', value: formatDimensions(media.metadata.width, media.metadata.height) },
      { label: 'File size', value: formatFileSize(media.metadata.file_size) },
      { label: 'Duration', value: formatDuration(media.metadata.duration_seconds) },
      {
        label: 'Frame count',
        value: media.metadata.frame_count == null ? '' : `${media.metadata.frame_count}`,
      },
      { label: 'Captured at', value: formatDateTime(media.metadata.captured_at) },
      { label: 'Added at', value: formatDateTime(media.uploaded_at) },
      { label: 'Visibility', value: formatVisibility(media.visibility) },
      { label: 'NSFW', value: media.is_nsfw ? 'Yes' : 'No' },
      { label: 'Sensitive', value: media.is_sensitive ? 'Yes' : 'No' },
      { label: 'Tagging status', value: formatProcessingStatus(media.tagging_status) },
      { label: 'Thumbnail status', value: formatProcessingStatus(media.thumbnail_status) },
      { label: 'Poster status', value: formatProcessingStatus(media.poster_status) },
    ].filter((field) => field.value);
  });
  readonly uploadFields = computed<InspectorField[]>(() => {
    const media = this.media();
    return [
      { label: 'Uploaded at', value: formatDateTime(media.uploaded_at) },
    ].filter((field) => field.value);
  });
  readonly authorFields = computed<InspectorField[]>(() => {
    const media = this.media();
    return [
      { label: 'Owner', value: media.owner_username ?? '' },
      { label: 'Uploaded by', value: media.uploader_username ?? '' },
    ].filter((field) => field.value);
  });
  readonly characters = computed(() =>
    this.entityDisplayItems(MediaEntityType.CHARACTER),
  );
  readonly series = computed(() =>
    this.entityDisplayItems(MediaEntityType.SERIES),
  );
  readonly externalRefs = computed(() =>
    (this.detail()?.external_refs ?? []).map((ref) => ({
      label: humanizeBackendLabel(ref.provider),
      value: ref.external_id ?? ref.url ?? '',
      url: ref.url,
    })),
  );
  readonly tags = computed(() => this.media().tags);
  readonly detectedText = computed(() => {
    const media = this.media();
    return media.ocr_text_override?.trim() || media.ocr_text?.trim() || '';
  });
  readonly detectedOcrText = computed(() => this.media().ocr_text?.trim() || '');
  readonly editableOcrValue = computed(() => this.draft().ocrTextOverride);
  readonly editableTags = computed(() => this.draft().tags);
  readonly editableCharacters = computed(() => this.draft().characterNames);
  readonly editableSeries = computed(() => this.draft().seriesNames);

  private objectUrl: string | null = null;
  private loadRequestId = 0;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private panStartX = 0;
  private panStartY = 0;
  private gestureMode: GestureMode = 'idle';
  private activePointers = new Map<number, PointerTracker>();
  private swipePointerId: number | null = null;
  private panPointerId: number | null = null;
  private pinchDistance = 0;
  private pinchMidpoint: GesturePoint | null = null;
  private detailsPointerId: number | null = null;
  private detailsStartX = 0;
  private detailsStartY = 0;
  private lastSheetSwipeAt = 0;
  private chromeHideTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMediaTapTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMediaTapAt = 0;
  private favoriteFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private favoriteFeedbackId = 0;

  constructor() {
    const items = this.data.items.length > 0 ? [...this.data.items] : [];
    this.items.set(items);
    const initialIndex = Math.max(
      0,
      items.findIndex((item) => item.id === this.data.activeMediaId),
    );
    this.activeIndex.set(initialIndex);
    this.beginLoadForActiveItem();
    this.resetDraftFromCurrentMedia();
    this.revealChrome();

    this.breakpointObserver
      .observe(MediaInspectorDialogComponent.MOBILE_QUERY)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ matches }) => {
        this.isMobile.set(matches);
        if (matches) {
          this.mobileDetailsOpen.set(false);
        }
      });

    this.tagInputControl.valueChanges
      .pipe(
        debounceTime(150),
        distinctUntilChanged(),
        switchMap((value) => {
          const query = value.trim();
          if (!query) {
            return of({ items: [] as TagRead[] });
          }
          return this.tagsClient.list({ q: query, page_size: 8, scope: 'owner' });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        const selected = new Set(this.draft().tags);
        this.tagSuggestions.set(response.items.filter((tag) => !selected.has(tag.name)));
      });

    this.characterInputControl.valueChanges
      .pipe(
        debounceTime(150),
        distinctUntilChanged(),
        switchMap((value) => {
          const query = value.trim();
          if (!query) {
            return of([]);
          }
          return this.mediaService.getCharacterSuggestions(query, 8, 'owner');
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((suggestions) => {
        const selected = new Set(this.draft().characterNames);
        this.characterSuggestions.set(suggestions.filter((item) => !selected.has(item.name)));
      });

    this.seriesInputControl.valueChanges
      .pipe(
        debounceTime(150),
        distinctUntilChanged(),
        switchMap((value) => {
          const query = value.trim();
          if (!query) {
            return of([]);
          }
          return this.mediaService.getSeriesSuggestions(query, 8, 'owner');
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((suggestions) => {
        const selected = new Set(this.draft().seriesNames);
        this.seriesSuggestions.set(suggestions.filter((item) => !selected.has(item.name)));
      });
  }

  ngOnDestroy(): void {
    this.revokeObjectUrl();
    this.clearChromeHideTimer();
    this.clearPendingMediaTap();
    this.clearFavoriteFeedback();
  }

  close(): void {
    this.dialogRef.close();
  }

  previous(): void {
    if (!this.hasPrevious()) {
      return;
    }
    this.navigateTo(this.activeIndex() - 1);
  }

  next(): void {
    if (!this.hasNext()) {
      return;
    }
    this.navigateTo(this.activeIndex() + 1);
  }

  beginEdit(): void {
    this.resetDraftFromCurrentMedia();
    this.editing.set(true);
    if (this.isMobile()) {
      this.mobileDetailsOpen.set(true);
    }
  }

  cancelEdit(): void {
    this.resetDraftFromCurrentMedia();
    this.editing.set(false);
  }

  toggleMobileDetails(): void {
    if (!this.isMobile()) {
      return;
    }
    this.revealChrome();
    this.mobileDetailsOpen.update((open) => !open);
  }

  onSheetToggleClick(event?: Event): void {
    if (Date.now() - this.lastSheetSwipeAt < 400) {
      event?.preventDefault();
      return;
    }

    this.toggleMobileDetails();
  }

  onViewerPointerDown(event: PointerEvent): void {
    if (this.isInteractiveTarget(event.target)) {
      this.revealChrome();
    }
  }

  onViewerPointerMove(event: PointerEvent): void {
    if (event.pointerType === 'mouse' || this.activePointers.has(event.pointerId)) {
      this.revealChrome();
    }
  }

  onViewerSurfaceClick(event: Event): void {
    if (this.isInteractiveTarget(event.target)) {
      this.revealChrome();
      return;
    }

    if (this.isMobile() && this.isImage() && this.isMediaTarget(event.target)) {
      this.handleMobileMediaTap(event);
      return;
    }

    if (this.chromeVisible()) {
      this.hideChrome();
      return;
    }

    this.revealChrome();
  }

  toggleFavorite(): void {
    this.commitFavoriteToggle(false);
  }

  onSheetHandlePointerDown(event: PointerEvent): void {
    if (!this.isMobile() || !isTouchLikePointer(event.pointerType)) {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    event.preventDefault();
    this.revealChrome();
    this.detailsPointerId = event.pointerId;
    this.detailsStartX = event.clientX;
    this.detailsStartY = event.clientY;
  }

  addTypedTag(): void {
    this.commitTag(this.tagInputControl.getRawValue());
  }

  addTypedCharacter(): void {
    this.commitCharacter(this.characterInputControl.getRawValue());
  }

  addTypedSeries(): void {
    this.commitSeries(this.seriesInputControl.getRawValue());
  }

  addTypedTagFromEvent(event: Event): void {
    event.preventDefault();
    this.addTypedTag();
  }

  addTypedCharacterFromEvent(event: Event): void {
    event.preventDefault();
    this.addTypedCharacter();
  }

  addTypedSeriesFromEvent(event: Event): void {
    event.preventDefault();
    this.addTypedSeries();
  }

  selectTag(tagName: string): void {
    this.commitTag(tagName);
  }

  selectCharacter(characterName: string): void {
    this.commitCharacter(characterName);
  }

  selectSeries(seriesName: string): void {
    this.commitSeries(seriesName);
  }

  removeTag(tag: string): void {
    this.draft.update((draft) => ({
      ...draft,
      tags: draft.tags.filter((value) => value !== tag),
    }));
    this.refreshSuggestionFilters();
  }

  removeCharacter(characterName: string): void {
    this.draft.update((draft) => ({
      ...draft,
      characterNames: draft.characterNames.filter((value) => value !== characterName),
    }));
    this.refreshSuggestionFilters();
  }

  removeSeries(seriesName: string): void {
    this.draft.update((draft) => ({
      ...draft,
      seriesNames: draft.seriesNames.filter((value) => value !== seriesName),
    }));
    this.refreshSuggestionFilters();
  }

  updateOcrOverride(value: string): void {
    this.draft.update((draft) => ({
      ...draft,
      ocrTextOverride: value,
    }));
  }

  updateNsfwOverride(value: boolean | null): void {
    this.draft.update((draft) => ({
      ...draft,
      nsfwOverride: value,
    }));
  }

  updateSensitiveOverride(value: boolean | null): void {
    this.draft.update((draft) => ({
      ...draft,
      sensitiveOverride: value,
    }));
  }

  save(): void {
    const media = this.media();
    if (this.saving() || !media) {
      return;
    }

    this.revealChrome();
    this.saving.set(true);
    const draft = this.draft();
    const ocrTextOverride = draft.ocrTextOverride.trim();

    this.mediaService
      .update(media.id, {
        tags: [...draft.tags],
        entities: [
          ...draft.characterNames.map((name) => ({
            entity_type: MediaEntityType.CHARACTER,
            name,
          })),
          ...draft.seriesNames.map((name) => ({
            entity_type: MediaEntityType.SERIES,
            name,
          })),
        ],
        ocr_text_override: ocrTextOverride ? ocrTextOverride : null,
        is_nsfw_override: draft.nsfwOverride,
        is_sensitive_override: draft.sensitiveOverride,
        version: media.version,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.detail.set(updated);
          this.replaceActiveItem(updated);
          this.galleryStore.patchItem(updated);
          this.resetDraftFromMedia(updated);
          this.editing.set(false);
          this.saving.set(false);
          this.snackBar.open('Media metadata updated.', 'Close', { duration: 3000 });
        },
        error: (error: { status?: number }) => {
          this.saving.set(false);
          const message =
            error?.status === 409
              ? 'This media changed elsewhere. Reload and try again.'
              : 'Could not save media metadata. Please try again.';
          this.snackBar.open(message, 'Close', { duration: 4000 });
        },
      });
  }

  onWheelZoom(event: WheelEvent): void {
    if (!this.isImage() || this.loading() || !this.mediaUrl()) {
      return;
    }

    this.revealChrome();
    event.preventDefault();
    this.applyZoom(this.zoom() + -event.deltaY * 0.0015, event.clientX, event.clientY);
  }

  onStagePointerDown(event: PointerEvent): void {
    if (!this.isImage() || this.loading() || !this.mediaUrl()) {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (this.isEditableTarget(event.target)) {
      return;
    }

    event.preventDefault();
    this.activePointers.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType,
    });

    if (this.activePointers.size >= 2) {
      this.beginPinchGesture();
      return;
    }

    const pointer = this.activePointers.get(event.pointerId);
    if (!pointer) {
      return;
    }
    this.beginSinglePointerGesture(event.pointerId, pointer);
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (this.detailsPointerId === event.pointerId) {
      this.revealChrome();
      const deltaX = Math.abs(event.clientX - this.detailsStartX);
      const deltaY = Math.abs(event.clientY - this.detailsStartY);
      if (deltaY > deltaX && deltaY > 8) {
        event.preventDefault();
      }
      return;
    }

    const trackedPointer = this.activePointers.get(event.pointerId);
    if (!trackedPointer) {
      return;
    }

    this.revealChrome();
    this.activePointers.set(event.pointerId, {
      ...trackedPointer,
      clientX: event.clientX,
      clientY: event.clientY,
    });

    if (this.activePointers.size >= 2) {
      this.updatePinchGesture();
      return;
    }

    if (this.gestureMode === 'pinch') {
      const remainingPointer = this.firstPointer();
      if (remainingPointer) {
        this.beginSinglePointerGesture(remainingPointer.id, remainingPointer.pointer);
      }
    }

    if (this.gestureMode !== 'pan' || this.panPointerId !== event.pointerId) {
      return;
    }

    this.dragging.set(true);
    this.applyPan(
      this.panStartX + event.clientX - this.pointerStartX,
      this.panStartY + event.clientY - this.pointerStartY,
    );
  }

  @HostListener('document:pointerup', ['$event'])
  @HostListener('document:pointercancel', ['$event'])
  stopPointerInteraction(event: PointerEvent): void {
    if (this.detailsPointerId === event.pointerId) {
      this.finishDetailsSwipeGesture(event.clientX, event.clientY);
      this.clearDetailsSwipeGesture();
      return;
    }

    const trackedPointer = this.activePointers.get(event.pointerId);
    if (!trackedPointer) {
      return;
    }

    if (
      this.gestureMode === 'swipe' &&
      this.swipePointerId === event.pointerId &&
      this.zoom() <= 1
    ) {
      this.finishSwipeGesture(event.clientX, event.clientY);
    }

    this.activePointers.delete(event.pointerId);

    if (this.activePointers.size >= 2) {
      this.beginPinchGesture();
      return;
    }

    if (this.activePointers.size === 1) {
      const remainingPointer = this.firstPointer();
      if (remainingPointer) {
        this.beginSinglePointerGesture(remainingPointer.id, remainingPointer.pointer);
      }
      return;
    }

    this.clearGestureState();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    this.revealChrome();
    if (event.key === 'Escape') {
      this.close();
      return;
    }

    if (this.isEditableTarget(event.target)) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.previous();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.next();
    }
  }

  trackByLabel(_: number, field: InspectorField): string {
    return field.label;
  }

  displayMetadataName(value: string): string {
    return formatMetadataName(value);
  }

  private navigateTo(index: number): void {
    if (index < 0 || index >= this.items().length) {
      return;
    }

    const item = this.items()[index];
    if (!item) {
      return;
    }

    this.revealChrome();
    this.activeIndex.set(index);
    this.activeMediaChanged.emit(item.id);
    this.editing.set(false);
    this.resetViewport();
    this.beginLoadForActiveItem();
    this.resetDraftFromCurrentMedia();
  }

  private revokeObjectUrl(): void {
    if (!this.objectUrl) {
      return;
    }

    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  resetZoom(): void {
    this.applyZoom(1);
  }

  private applyZoom(value: number, anchorClientX?: number, anchorClientY?: number): void {
    const nextZoom = clampNumber(value, 1, 6);
    if (nextZoom <= 1) {
      this.resetViewport();
      return;
    }

    let nextPanX = this.panX();
    let nextPanY = this.panY();
    if (anchorClientX != null && anchorClientY != null) {
      const anchor = this.relativePointFromClient(anchorClientX, anchorClientY);
      if (anchor) {
        const scaleRatio = nextZoom / this.zoom();
        nextPanX = anchor.x - scaleRatio * (anchor.x - nextPanX);
        nextPanY = anchor.y - scaleRatio * (anchor.y - nextPanY);
      }
    }

    const clampedPan = this.clampPan(nextPanX, nextPanY, nextZoom);
    this.zoom.set(nextZoom);
    this.panX.set(clampedPan.x);
    this.panY.set(clampedPan.y);
  }

  private resetViewport(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
    this.clearGestureState();
  }

  private beginLoadForActiveItem(): void {
    const media = this.activeItem();
    if (!media) {
      return;
    }

    this.revealChrome();
    const requestId = ++this.loadRequestId;
    this.detail.set(null);
    this.mediaUrl.set(null);
    this.detailError.set('');
    this.fileError.set('');
    this.loadingDetail.set(true);
    this.loadingFile.set(true);
    this.revokeObjectUrl();

    this.mediaService
      .get(media.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          if (requestId !== this.loadRequestId) {
            return;
          }
          this.detail.set(detail);
          this.replaceActiveItem(detail);
          this.resetDraftFromMedia(detail);
          this.loadingDetail.set(false);
        },
        error: () => {
          if (requestId !== this.loadRequestId) {
            return;
          }
          this.detailError.set('Unable to load media details.');
          this.loadingDetail.set(false);
        },
      });

    this.mediaService
      .getFileUrl(media.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (url) => {
          if (requestId !== this.loadRequestId) {
            URL.revokeObjectURL(url);
            return;
          }
          this.revokeObjectUrl();
          this.objectUrl = url;
          this.mediaUrl.set(url);
          this.loadingFile.set(false);
        },
        error: () => {
          if (requestId !== this.loadRequestId) {
            return;
          }
          this.fileError.set('Unable to load the media file.');
          this.loadingFile.set(false);
        },
      });
  }

  private replaceActiveItem(updated: MediaRead): void {
    const currentIndex = this.activeIndex();
    this.items.update((items) =>
      items.map((item, index) => (index === currentIndex ? updated : item)),
    );
  }

  private applyLocalMediaUpdate(updated: MediaRead): void {
    this.replaceActiveItem(updated);
    const detail = this.detail();
    if (detail?.id === updated.id) {
      this.detail.set({
        ...detail,
        ...updated,
      });
    }
  }

  private resetDraftFromCurrentMedia(): void {
    const media = this.detail() ?? this.activeItem();
    if (media) {
      this.resetDraftFromMedia(media);
    }
  }

  private resetDraftFromMedia(media: MediaRead | MediaDetail): void {
    const detail = media as MediaDetail;
    const characterNames = dedupeNames(
      (detail.entities ?? [])
        .filter((entity) => entity.entity_type === MediaEntityType.CHARACTER)
        .map((entity) => entity.name),
    );
    const seriesNames = dedupeNames(
      (detail.entities ?? [])
        .filter((entity) => entity.entity_type === MediaEntityType.SERIES)
        .map((entity) => entity.name),
    );
    this.draft.set({
      tags: [...media.tags],
      characterNames,
      seriesNames,
      ocrTextOverride: media.ocr_text_override ?? '',
      nsfwOverride: media.is_nsfw_override ?? null,
      sensitiveOverride: media.is_sensitive_override ?? null,
    });
    this.tagInputControl.setValue('', { emitEvent: false });
    this.characterInputControl.setValue('', { emitEvent: false });
    this.seriesInputControl.setValue('', { emitEvent: false });
    this.tagSuggestions.set([]);
    this.characterSuggestions.set([]);
    this.seriesSuggestions.set([]);
  }

  private refreshSuggestionFilters(): void {
    const selectedTags = new Set(this.draft().tags);
    const selectedCharacters = new Set(this.draft().characterNames);
    const selectedSeries = new Set(this.draft().seriesNames);
    this.tagSuggestions.update((tags) => tags.filter((tag) => !selectedTags.has(tag.name)));
    this.characterSuggestions.update((items) =>
      items.filter((item) => !selectedCharacters.has(item.name)),
    );
    this.seriesSuggestions.update((items) =>
      items.filter((item) => !selectedSeries.has(item.name)),
    );
  }

  private commitTag(rawValue: string): void {
    const tag = normalizeChipValue(rawValue);
    if (!tag) {
      this.tagInputControl.setValue('', { emitEvent: false });
      return;
    }

    this.draft.update((draft) => ({
      ...draft,
      tags: draft.tags.includes(tag) ? draft.tags : [...draft.tags, tag],
    }));
    this.tagInputControl.setValue('', { emitEvent: false });
    this.refreshSuggestionFilters();
  }

  private commitCharacter(rawValue: string): void {
    const characterName = normalizeChipValue(rawValue);
    if (!characterName) {
      this.characterInputControl.setValue('', { emitEvent: false });
      return;
    }

    this.draft.update((draft) => ({
      ...draft,
      characterNames: draft.characterNames.includes(characterName)
        ? draft.characterNames
        : [...draft.characterNames, characterName],
    }));
    this.characterInputControl.setValue('', { emitEvent: false });
    this.refreshSuggestionFilters();
  }

  private commitSeries(rawValue: string): void {
    const seriesName = normalizeChipValue(rawValue);
    if (!seriesName) {
      this.seriesInputControl.setValue('', { emitEvent: false });
      return;
    }

    this.draft.update((draft) => ({
      ...draft,
      seriesNames: draft.seriesNames.includes(seriesName)
        ? draft.seriesNames
        : [...draft.seriesNames, seriesName],
    }));
    this.seriesInputControl.setValue('', { emitEvent: false });
    this.refreshSuggestionFilters();
  }

  private entityDisplayItems(entityType: MediaEntityType) {
    return (this.detail()?.entities ?? [])
      .filter((entity) => entity.entity_type === entityType)
      .map((entity) => ({
        name: entity.name,
        label: formatMetadataName(entity.name),
        details: [
          entity.role ? humanizeBackendLabel(entity.role) : '',
          entity.source ? humanizeBackendLabel(entity.source) : '',
          entity.confidence == null ? '' : `Confidence ${formatConfidence(entity.confidence)}`,
        ]
          .filter(Boolean)
          .join(' • '),
      }));
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (
      target.closest(
        'button, a, input, textarea, select, option, [role="button"], [contenteditable="true"]',
      )
    ) {
      return true;
    }

    const tagName = target.tagName.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
  }

  private beginSinglePointerGesture(pointerId: number, pointer: PointerTracker): void {
    this.pointerStartX = pointer.clientX;
    this.pointerStartY = pointer.clientY;
    this.panStartX = this.panX();
    this.panStartY = this.panY();
    this.panPointerId = null;
    this.swipePointerId = null;

    if (this.zoom() > 1) {
      this.gestureMode = 'pan';
      this.panPointerId = pointerId;
      this.dragging.set(true);
      return;
    }

    this.dragging.set(false);
    if (isTouchLikePointer(pointer.pointerType)) {
      this.gestureMode = 'swipe';
      this.swipePointerId = pointerId;
      return;
    }

    this.gestureMode = 'idle';
  }

  private beginPinchGesture(): void {
    const pinchData = this.currentPinchData();
    if (!pinchData) {
      return;
    }

    this.gestureMode = 'pinch';
    this.dragging.set(true);
    this.swipePointerId = null;
    this.panPointerId = null;
    this.pinchDistance = pinchData.distance;
    this.pinchMidpoint = pinchData.midpoint;
  }

  private updatePinchGesture(): void {
    const pinchData = this.currentPinchData();
    if (!pinchData || this.pinchMidpoint == null || this.pinchDistance <= 0) {
      return;
    }

    const previousMidpoint = this.pinchMidpoint;
    const deltaX = pinchData.midpoint.x - previousMidpoint.x;
    const deltaY = pinchData.midpoint.y - previousMidpoint.y;
    const targetZoom = this.zoom() * (pinchData.distance / this.pinchDistance);

    this.panStartX = this.panX() + deltaX;
    this.panStartY = this.panY() + deltaY;
    this.panX.set(this.panStartX);
    this.panY.set(this.panStartY);
    this.applyZoom(targetZoom, pinchData.midpoint.x, pinchData.midpoint.y);

    this.pinchDistance = pinchData.distance;
    this.pinchMidpoint = pinchData.midpoint;
  }

  private finishSwipeGesture(clientX: number, clientY: number): void {
    const deltaX = clientX - this.pointerStartX;
    const deltaY = clientY - this.pointerStartY;
    if (Math.abs(deltaX) < 60 || Math.abs(deltaY) > 48 || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }

    if (deltaX < 0) {
      this.next();
      return;
    }

    this.previous();
  }

  private finishDetailsSwipeGesture(clientX: number, clientY: number): void {
    const deltaX = clientX - this.detailsStartX;
    const deltaY = clientY - this.detailsStartY;
    if (Math.abs(deltaY) < 48 || Math.abs(deltaY) <= Math.abs(deltaX)) {
      return;
    }

    this.lastSheetSwipeAt = Date.now();
    this.mobileDetailsOpen.set(deltaY < 0);
  }

  private handleMobileMediaTap(event: Event): void {
    const now = Date.now();
    if (
      this.pendingMediaTapTimer &&
      now - this.lastMediaTapAt <= MediaInspectorDialogComponent.DOUBLE_TAP_DELAY_MS
    ) {
      const point = this.clientPointFromEvent(event);
      this.clearPendingMediaTap();
      this.revealChrome();
      this.commitFavoriteToggle(false, point);
      return;
    }

    this.lastMediaTapAt = now;
    this.pendingMediaTapTimer = setTimeout(() => {
      this.pendingMediaTapTimer = null;
      this.lastMediaTapAt = 0;
      if (this.chromeVisible()) {
        this.hideChrome();
        return;
      }

      this.revealChrome();
    }, MediaInspectorDialogComponent.DOUBLE_TAP_DELAY_MS);
  }

  private commitFavoriteToggle(forceAdd: boolean, feedbackPoint?: GesturePoint | null): void {
    const media = this.media();
    if (!media || this.favoritePending()) {
      return;
    }

    if (forceAdd && media.is_favorited) {
      this.showFavoriteFeedback(feedbackPoint, true);
      return;
    }

    const nextFavorited = forceAdd ? true : !media.is_favorited;
    const countDelta = nextFavorited === media.is_favorited ? 0 : nextFavorited ? 1 : -1;
    const optimistic = {
      ...media,
      is_favorited: nextFavorited,
      favorite_count: Math.max(0, (media.favorite_count ?? 0) + countDelta),
    };

    this.revealChrome();
    this.showFavoriteFeedback(feedbackPoint, nextFavorited);
    this.favoritePending.set(true);
    this.applyLocalMediaUpdate(optimistic);
    this.galleryStore
      .toggleFavorite(media)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.favoritePending.set(false);
          this.applyLocalMediaUpdate(updated);
        },
        error: () => {
          this.favoritePending.set(false);
          this.applyLocalMediaUpdate(media);
          this.snackBar.open('Could not update favorites. Please try again.', 'Close', {
            duration: 4000,
          });
        },
      });
  }

  private applyPan(nextPanX: number, nextPanY: number): void {
    const clampedPan = this.clampPan(nextPanX, nextPanY, this.zoom());
    this.panX.set(clampedPan.x);
    this.panY.set(clampedPan.y);
  }

  private clampPan(panX: number, panY: number, zoom: number): GesturePoint {
    if (zoom <= 1) {
      return { x: 0, y: 0 };
    }

    const stage = this.zoomStage()?.nativeElement;
    if (!stage) {
      return { x: panX, y: panY };
    }

    const bounds = stage.getBoundingClientRect();
    const maxPanX = Math.max(0, (bounds.width * zoom - bounds.width) / 2);
    const maxPanY = Math.max(0, (bounds.height * zoom - bounds.height) / 2);
    return {
      x: clampNumber(panX, -maxPanX, maxPanX),
      y: clampNumber(panY, -maxPanY, maxPanY),
    };
  }

  private relativePointFromClient(clientX: number, clientY: number): GesturePoint | null {
    const stage = this.zoomStage()?.nativeElement;
    if (!stage) {
      return null;
    }

    const bounds = stage.getBoundingClientRect();
    return {
      x: clientX - (bounds.left + bounds.width / 2),
      y: clientY - (bounds.top + bounds.height / 2),
    };
  }

  private currentPinchData():
    | {
        distance: number;
        midpoint: GesturePoint;
      }
    | null {
    const pointers = Array.from(this.activePointers.values()).filter((pointer) =>
      isTouchLikePointer(pointer.pointerType),
    );
    if (pointers.length < 2) {
      return null;
    }

    const [first, second] = pointers;
    return {
      distance: distanceBetweenPoints(first, second),
      midpoint: {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
      },
    };
  }

  private firstPointer():
    | {
        id: number;
        pointer: PointerTracker;
      }
    | null {
    const entry = this.activePointers.entries().next();
    if (entry.done) {
      return null;
    }

    const [id, pointer] = entry.value;
    return { id, pointer };
  }

  private clearGestureState(): void {
    this.gestureMode = 'idle';
    this.dragging.set(false);
    this.swipePointerId = null;
    this.panPointerId = null;
    this.pinchDistance = 0;
    this.pinchMidpoint = null;
    this.activePointers.clear();
  }

  private clearDetailsSwipeGesture(): void {
    this.detailsPointerId = null;
    this.detailsStartX = 0;
    this.detailsStartY = 0;
  }

  private revealChrome(): void {
    this.clearPendingMediaTap();
    this.chromeVisible.set(true);
    this.scheduleChromeHide();
  }

  private hideChrome(): void {
    this.clearPendingMediaTap();
    this.clearChromeHideTimer();
    this.chromeVisible.set(false);
  }

  private scheduleChromeHide(): void {
    this.clearChromeHideTimer();
    this.chromeHideTimer = setTimeout(() => {
      this.chromeVisible.set(false);
      this.chromeHideTimer = null;
    }, MediaInspectorDialogComponent.CHROME_HIDE_DELAY_MS);
  }

  private clearChromeHideTimer(): void {
    if (this.chromeHideTimer == null) {
      return;
    }

    clearTimeout(this.chromeHideTimer);
    this.chromeHideTimer = null;
  }

  private clearPendingMediaTap(): void {
    if (this.pendingMediaTapTimer == null) {
      return;
    }

    clearTimeout(this.pendingMediaTapTimer);
    this.pendingMediaTapTimer = null;
    this.lastMediaTapAt = 0;
  }

  private showFavoriteFeedback(point: GesturePoint | null | undefined, favorited: boolean): void {
    if (!this.isMobile() || !point) {
      return;
    }

    this.favoriteFeedbackId += 1;
    this.favoriteFeedback.set({
      favorited,
      id: this.favoriteFeedbackId,
      x: point.x,
      y: point.y,
    });

    if (this.favoriteFeedbackTimer != null) {
      clearTimeout(this.favoriteFeedbackTimer);
    }
    this.favoriteFeedbackTimer = setTimeout(() => {
      this.favoriteFeedback.set(null);
      this.favoriteFeedbackTimer = null;
    }, MediaInspectorDialogComponent.FAVORITE_FEEDBACK_MS);
  }

  private clearFavoriteFeedback(): void {
    if (this.favoriteFeedbackTimer != null) {
      clearTimeout(this.favoriteFeedbackTimer);
      this.favoriteFeedbackTimer = null;
    }
    this.favoriteFeedback.set(null);
  }

  private clientPointFromEvent(event: Event): GesturePoint | null {
    const pointerLike = event as MouseEvent;
    if (typeof pointerLike.clientX === 'number' && typeof pointerLike.clientY === 'number') {
      const stage = this.zoomStage()?.nativeElement;
      if (!stage) {
        return null;
      }

      const bounds = stage.getBoundingClientRect();
      return {
        x: pointerLike.clientX - bounds.left,
        y: pointerLike.clientY - bounds.top,
      };
    }

    return null;
  }

  private isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return target.closest(
      'button, a, input, textarea, select, option, [role="button"], [contenteditable="true"], .mat-mdc-chip, .mat-mdc-chip-row, .mat-mdc-option',
    ) != null;
  }

  private isMediaTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('.inspector-media') != null;
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeChipValue(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized ? normalized : null;
}

function dedupeNames(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isTouchLikePointer(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

function distanceBetweenPoints(first: PointerTracker, second: PointerTracker): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}
