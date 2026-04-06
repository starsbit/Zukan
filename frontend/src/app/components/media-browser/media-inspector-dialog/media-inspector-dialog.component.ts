import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
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
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { MediaDetail, MediaRead, MediaType } from '../../../models/media';
import { MediaEntityType } from '../../../models/relations';
import { CharacterSuggestion, SeriesSuggestion, TagRead } from '../../../models/tags';
import { GalleryStore } from '../../../services/gallery.store';
import { MediaService } from '../../../services/media.service';
import { TagsClientService } from '../../../services/web/tags-client.service';
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
}

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
    MatSnackBarModule,
    ReactiveFormsModule,
  ],
  templateUrl: './media-inspector-dialog.component.html',
  styleUrl: './media-inspector-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaInspectorDialogComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef<MediaInspectorDialogComponent>);
  protected readonly data = inject<MediaInspectorDialogData>(MAT_DIALOG_DATA);
  private readonly galleryStore = inject(GalleryStore);
  private readonly mediaService = inject(MediaService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly tagsClient = inject(TagsClientService);
  private readonly zoomStage = viewChild<ElementRef<HTMLElement>>('zoomStage');

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
  });

  readonly tagInputControl = new FormControl('', { nonNullable: true });
  readonly characterInputControl = new FormControl('', { nonNullable: true });
  readonly seriesInputControl = new FormControl('', { nonNullable: true });

  readonly activeItem = computed(() => this.items()[this.activeIndex()] ?? this.items()[0] ?? null);
  readonly media = computed<MediaRead | MediaDetail>(() => this.detail() ?? this.activeItem()!);
  readonly title = computed(() => this.media().original_filename ?? this.media().filename);
  readonly isVideo = computed(() => this.media().media_type === MediaType.VIDEO);
  readonly isImage = computed(() => !this.isVideo());
  readonly hasPrevious = computed(() => this.activeIndex() > 0);
  readonly hasNext = computed(() => this.activeIndex() < this.items().length - 1);
  readonly loading = computed(() => this.loadingDetail() || this.loadingFile());
  readonly mediaLoadError = computed(() => this.fileError() || '');
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
      { label: 'Added at', value: formatDateTime(media.created_at) },
      { label: 'Visibility', value: formatVisibility(media.visibility) },
      { label: 'NSFW', value: media.is_nsfw ? 'Yes' : 'No' },
      { label: 'Sensitive', value: media.is_sensitive ? 'Yes' : 'No' },
      { label: 'Tagging status', value: formatProcessingStatus(media.tagging_status) },
      { label: 'Thumbnail status', value: formatProcessingStatus(media.thumbnail_status) },
      { label: 'Poster status', value: formatProcessingStatus(media.poster_status) },
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

    this.tagInputControl.valueChanges
      .pipe(
        debounceTime(150),
        distinctUntilChanged(),
        switchMap((value) => {
          const query = value.trim();
          if (!query) {
            return of({ items: [] as TagRead[] });
          }
          return this.tagsClient.list({ q: query, page_size: 8 });
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
          return this.mediaService.getCharacterSuggestions(query, 8);
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
          return this.mediaService.getSeriesSuggestions(query, 8);
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
  }

  cancelEdit(): void {
    this.resetDraftFromCurrentMedia();
    this.editing.set(false);
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

  save(): void {
    const media = this.media();
    if (this.saving() || !media) {
      return;
    }

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

    event.preventDefault();
    this.applyZoom(this.zoom() + -event.deltaY * 0.0015);
  }

  startPan(event: PointerEvent): void {
    if (!this.isImage() || this.zoom() <= 1) {
      return;
    }

    event.preventDefault();
    this.dragging.set(true);
    this.pointerStartX = event.clientX;
    this.pointerStartY = event.clientY;
    this.panStartX = this.panX();
    this.panStartY = this.panY();
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }

    const stage = this.zoomStage()?.nativeElement;
    if (!stage) {
      return;
    }

    const bounds = stage.getBoundingClientRect();
    const maxPanX = Math.max(0, (bounds.width * this.zoom() - bounds.width) / 2);
    const maxPanY = Math.max(0, (bounds.height * this.zoom() - bounds.height) / 2);
    this.panX.set(
      clampNumber(this.panStartX + event.clientX - this.pointerStartX, -maxPanX, maxPanX),
    );
    this.panY.set(
      clampNumber(this.panStartY + event.clientY - this.pointerStartY, -maxPanY, maxPanY),
    );
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  stopPan(): void {
    this.dragging.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
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

    this.activeIndex.set(index);
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

  private applyZoom(value: number): void {
    const nextZoom = clampNumber(value, 1, 6);
    this.zoom.set(nextZoom);
    if (nextZoom <= 1) {
      this.panX.set(0);
      this.panY.set(0);
      this.dragging.set(false);
    }
  }

  private resetViewport(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
    this.dragging.set(false);
  }

  private beginLoadForActiveItem(): void {
    const media = this.activeItem();
    if (!media) {
      return;
    }

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
        name: formatMetadataName(entity.name),
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

    const tagName = target.tagName.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || target.isContentEditable;
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
