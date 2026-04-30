import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import { MediaDetail, MediaType } from '../../../models/media';
import { MediaEntityType } from '../../../models/relations';
import { RarityTier } from '../../../models/gacha';
import { MediaService } from '../../../services/media.service';
import { NavbarSearchService } from '../../../services/navbar-search.service';
import { formatDateTime, formatMetadataName } from '../../../utils/media-display.utils';
import {
  MetadataFilterChipComponent,
  MetadataFilterSelection,
} from '../../../components/shared/metadata-filter-chip/metadata-filter-chip.component';
import { GachaDisplayCardComponent } from '../gacha-display-card/gacha-display-card.component';
import { GachaRarityParticlesComponent } from '../gacha-rarity-particles/gacha-rarity-particles.component';

export interface GachaInspectorCard {
  id: string;
  mediaId: string;
  rarity: RarityTier;
  title: string;
  thumbnailUrl: string | null;
  contextLabel: string;
  mediaInspectorPath?: '/gallery' | '/browse';
  currentUserId?: string | null;
  level?: number;
  copiesPulled?: number;
  locked?: boolean;
  tradeable?: boolean;
  acquiredAt?: string;
  updatedAt?: string;
  tags?: readonly string[];
  characters?: readonly string[];
  series?: readonly string[];
}

export interface GachaCardInspectorDialogData {
  card: GachaInspectorCard;
}

interface InspectorField {
  label: string;
  value: string;
}

interface InspectorMetadataChip {
  value: string;
  display: string;
}

@Component({
  selector: 'zukan-gacha-card-inspector',
  standalone: true,
  imports: [
    GachaDisplayCardComponent,
    GachaRarityParticlesComponent,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MetadataFilterChipComponent,
  ],
  templateUrl: './gacha-card-inspector.component.html',
  styleUrl: './gacha-card-inspector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GachaCardInspectorDialogComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef<GachaCardInspectorDialogComponent>);
  private readonly mediaService = inject(MediaService);
  private readonly router = inject(Router);
  private readonly searchService = inject(NavbarSearchService);
  protected readonly data = inject<GachaCardInspectorDialogData>(MAT_DIALOG_DATA);

  readonly detail = signal<MediaDetail | null>(null);
  readonly previewUrl = signal<string | null>(this.data.card.thumbnailUrl);
  readonly loadingPreview = signal(false);
  readonly previewError = signal('');

  readonly title = computed(() => this.displayName(this.data.card.title) || 'Untitled collection item');
  readonly previewMeta = computed(() => [
    ...(this.data.card.level == null ? [] : [`Lv. ${this.data.card.level}`]),
    ...(this.data.card.copiesPulled == null ? [] : [this.copyLabel(this.data.card.copiesPulled)]),
  ]);
  readonly characters = computed(() => this.metadataChips(
    this.entityNames(MediaEntityType.CHARACTER, this.data.card.characters),
  ));
  readonly series = computed(() => this.metadataChips(
    this.entityNames(MediaEntityType.SERIES, this.data.card.series),
  ));
  readonly tags = computed(() => this.metadataChips(this.detail()?.tags ?? this.data.card.tags ?? []));
  readonly stateChips = computed(() => [
    ...(this.data.card.locked ? ['Locked'] : []),
    ...(this.data.card.tradeable ? ['Tradeable'] : []),
  ]);
  readonly fields = computed<InspectorField[]>(() => [
    { label: 'Rarity', value: this.data.card.rarity },
    ...(this.data.card.level == null ? [] : [{ label: 'Level', value: `${this.data.card.level}` }]),
    ...(this.data.card.copiesPulled == null ? [] : [{ label: 'Copies', value: `${this.data.card.copiesPulled}` }]),
    ...(this.data.card.acquiredAt ? [{ label: 'Acquired', value: formatDateTime(this.data.card.acquiredAt) }] : []),
    ...(this.data.card.updatedAt ? [{ label: 'Updated', value: formatDateTime(this.data.card.updatedAt) }] : []),
  ].filter((field) => field.value));

  private objectUrl: string | null = null;

  ngOnInit(): void {
    this.loadDetail();
  }

  ngOnDestroy(): void {
    this.revokeObjectUrl();
  }

  close(): void {
    this.dialogRef.close();
  }

  filterBy(selection: MetadataFilterSelection): void {
    this.searchService.suppressNextUrlSync();
    this.searchService.addMetadataFilter(selection.type, selection.value);
    this.router.navigate(['/gallery'], {
      queryParams: this.searchService.toQueryParamsWithClears(),
    });
    this.close();
  }

  openMediaInspector(): void {
    if (!this.detail() && this.data.card.currentUserId) {
      this.mediaService.get(this.data.card.mediaId).pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of(null)),
      ).subscribe((detail) => {
        if (detail) {
          this.detail.set(detail);
        }
        this.navigateToMediaInspector();
      });
      return;
    }

    this.navigateToMediaInspector();
  }

  private navigateToMediaInspector(): void {
    void this.router.navigate([this.mediaInspectorPath()], {
      queryParams: { inspect: this.data.card.mediaId },
    }).catch(() => undefined);
    this.close();
  }

  private loadDetail(): void {
    this.loadingPreview.set(true);
    this.mediaService.get(this.data.card.mediaId).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError(() => {
        this.loadingPreview.set(false);
        return of(null);
      }),
    ).subscribe((detail) => {
      if (!detail) {
        return;
      }

      this.detail.set(detail);
      this.loadPreview(detail);
    });
  }

  private loadPreview(detail: MediaDetail): void {
    const previewRequest = detail.media_type === MediaType.VIDEO
      ? this.mediaService.getPosterUrl(detail.id)
      : this.mediaService.getFileUrl(detail.id);

    previewRequest.pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError(() => {
        this.loadingPreview.set(false);
        this.previewError.set(this.previewUrl() ? '' : 'Unable to load preview.');
        return of(null);
      }),
    ).subscribe((url) => {
      this.loadingPreview.set(false);
      if (!url) {
        return;
      }

      if (detail.media_type !== MediaType.VIDEO) {
        this.revokeObjectUrl();
        this.objectUrl = url;
      }
      this.previewUrl.set(url);
    });
  }

  private entityNames(type: MediaEntityType, fallback: readonly string[] | undefined): readonly string[] {
    const entities = this.detail()?.entities
      .filter((entity) => entity.entity_type === type)
      .map((entity) => entity.name) ?? [];
    return entities.length > 0 ? entities : fallback ?? [];
  }

  private metadataChips(values: readonly string[]): InspectorMetadataChip[] {
    return values
      .map((value) => ({
        value,
        display: this.displayName(value),
      }))
      .filter((chip) => chip.display.length > 0)
      .filter((chip, index, chips) => (
        chips.findIndex((candidate) => candidate.value.toLowerCase() === chip.value.toLowerCase()) === index
      ));
  }

  private displayName(value: string | null | undefined): string {
    return formatMetadataName(value);
  }

  private copyLabel(value: number): string {
    return value === 1 ? '1 copy' : `${value} copies`;
  }

  private mediaInspectorPath(): '/gallery' | '/browse' {
    const detail = this.detail();
    const currentUserId = this.data.card.currentUserId;
    if (detail && currentUserId && (detail.owner_id === currentUserId || detail.uploader_id === currentUserId)) {
      return '/gallery';
    }
    if (detail && currentUserId) {
      return '/browse';
    }
    return this.data.card.mediaInspectorPath ?? '/gallery';
  }

  private revokeObjectUrl(): void {
    if (!this.objectUrl) {
      return;
    }

    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
