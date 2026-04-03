import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  computed,
  effect,
  inject,
  signal,
  input,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MediaType } from '../../models/media';
import { MediaSearchParams } from '../../services/web/media-client.service';
import { MediaService } from '../../services/media.service';
import { TodayStoriesStore } from './today-stories.store';
import { TodayStoriesViewerComponent } from './today-stories-viewer.component';

@Component({
  selector: 'zukan-today-stories-rail',
  standalone: true,
  templateUrl: './today-stories-rail.component.html',
  styleUrl: './today-stories-rail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [TodayStoriesStore],
})
export class TodayStoriesRailComponent {
  readonly params = input.required<MediaSearchParams>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly injector = inject(Injector);
  private readonly mediaService = inject(MediaService);
  protected readonly store = inject(TodayStoriesStore);

  readonly groups = this.store.groups;
  readonly hasItems = this.store.hasItems;
  readonly previewUrls = signal<Record<string, string>>({});
  readonly initials = computed(() => 'YA');

  constructor() {
    effect(() => {
      this.store.setParams(this.params());
    });

    effect(() => {
      const groups = this.groups();
      for (const group of groups) {
        const item = group.coverItem;
        if (this.previewUrls()[item.id]) {
          continue;
        }

        const request = item.media_type === MediaType.VIDEO
          ? this.mediaService.getPosterUrl(item.id)
          : this.mediaService.getThumbnailUrl(item.id);

        request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (url) => {
            this.previewUrls.update((current) => ({ ...current, [item.id]: url }));
          },
          error: () => {},
        });
      }
    });
  }

  openStory(yearsAgo: number): void {
    const group = this.groups().find((candidate) => candidate.yearsAgo === yearsAgo);
    if (!group) {
      return;
    }

    this.dialog.open(TodayStoriesViewerComponent, {
      data: { yearsAgo, initialIndex: 0 },
      width: '100vw',
      height: '100vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      autoFocus: false,
      panelClass: 'today-stories-viewer-panel',
      injector: Injector.create({
        providers: [{ provide: TodayStoriesStore, useValue: this.store }],
        parent: this.injector,
      }),
    });
  }
}
