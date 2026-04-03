import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../models/media';
import { GalleryStore } from '../../services/gallery.store';
import { MediaService } from '../../services/media.service';
import { MediaClientService } from '../../services/web/media-client.service';
import { TodayStoriesRailComponent } from './today-stories-rail.component';

describe('TodayStoriesRailComponent', () => {
  it('renders one card per years-ago group and opens the matching group', async () => {
    const dialog = { open: vi.fn() };
    const mediaClient = {
      search: vi.fn(() => of({
        items: [
          makeMedia('m1', '2024-04-02T12:00:00Z'),
          makeMedia('m2', '2024-04-02T08:00:00Z'),
          makeMedia('m3', '2023-04-02T12:00:00Z'),
        ],
        total: 3,
        next_cursor: null,
        has_more: false,
        page_size: 100,
      })),
    };

    await TestBed.configureTestingModule({
      imports: [TodayStoriesRailComponent],
      providers: [
        { provide: MatDialog, useValue: dialog },
        { provide: MediaClientService, useValue: mediaClient },
        { provide: GalleryStore, useValue: { patchItem: vi.fn(), removeItem: vi.fn() } },
        {
          provide: MediaService,
          useValue: {
            getThumbnailUrl: vi.fn((id: string) => of(`blob:${id}`)),
            getPosterUrl: vi.fn((id: string) => of(`blob:${id}`)),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TodayStoriesRailComponent);
    fixture.componentRef.setInput('params', { captured_month: 4, captured_day: 2, captured_before_year: 2026 });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.today-stories__card');
    expect(cards.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('2 years ago');
    expect(fixture.nativeElement.textContent).toContain('3 years ago');
    expect(fixture.nativeElement.textContent).not.toContain('Flashbacks');
    expect(fixture.nativeElement.textContent).not.toContain('Public memories');
    expect(fixture.nativeElement.textContent).not.toContain('memories');

    (cards[0] as HTMLButtonElement).click();

    expect(dialog.open).toHaveBeenCalled();
    expect(dialog.open.mock.calls[0]?.[1]?.data).toEqual({
      yearsAgo: 2,
      initialIndex: 0,
    });
  });
});

function makeMedia(id: string, capturedAt: string) {
  return {
    id,
    uploader_id: null,
    owner_id: null,
    visibility: MediaVisibility.PRIVATE,
    filename: `${id}.jpg`,
    original_filename: `${id}.jpg`,
    media_type: MediaType.IMAGE,
    metadata: {
      file_size: 10,
      width: 100,
      height: 100,
      duration_seconds: null,
      frame_count: null,
      mime_type: 'image/jpeg',
      captured_at: capturedAt,
    },
    version: 1,
    created_at: capturedAt,
    deleted_at: null,
    tags: [],
    ocr_text_override: null,
    is_nsfw: false,
    tagging_status: TaggingStatus.DONE,
    tagging_error: null,
    thumbnail_status: ProcessingStatus.DONE,
    poster_status: ProcessingStatus.NOT_APPLICABLE,
    ocr_text: null,
    is_favorited: false,
    favorite_count: 0,
  };
}
