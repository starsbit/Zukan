import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../models/media';
import { MediaService } from '../../services/media.service';
import { TodayStoriesViewerComponent } from './today-stories-viewer.component';
import { TodayStoriesStore } from './today-stories.store';

describe('TodayStoriesViewerComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pauses timed advance while pressed and resumes afterward', async () => {
    const store = createStore();
    const dialogRef = { close: vi.fn() };
    const mediaService = { getFileUrl: vi.fn(() => of('blob:file')) };

    await TestBed.configureTestingModule({
      imports: [TodayStoriesViewerComponent],
      providers: [
        { provide: TodayStoriesStore, useValue: store },
        { provide: MediaService, useValue: mediaService },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { yearsAgo: 2, initialIndex: 0 } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TodayStoriesViewerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance.onHoldStart(new PointerEvent('pointerdown'));
    await vi.advanceTimersByTimeAsync(6000);
    expect(fixture.componentInstance.activeIndex()).toBe(0);

    fixture.componentInstance.onHoldEnd(new PointerEvent('pointerup'));
    await vi.advanceTimersByTimeAsync(IMAGE_DURATION_MS + 100);
    expect(fixture.componentInstance.activeIndex()).toBe(1);
  });

  it('does not reload the media file after liking the active story', async () => {
    const groupsSignal = signal([makeGroup(false)]);
    const toggleFavorite = vi.fn(() => {
      groupsSignal.update((groups) => [
        {
          ...groups[0]!,
          items: groups[0]!.items.map((item, index) => index === 0
            ? { ...item, is_favorited: true, favorite_count: item.favorite_count + 1 }
            : item),
          coverItem: { ...groups[0]!.coverItem, is_favorited: true, favorite_count: 1 },
        },
      ]);
      return of(groupsSignal()[0]!.items[0]!);
    });
    const store = {
      groups: computed(() => groupsSignal()),
      toggleFavorite,
    };
    const dialogRef = { close: vi.fn() };
    const mediaService = { getFileUrl: vi.fn(() => of('blob:file')) };

    await TestBed.configureTestingModule({
      imports: [TodayStoriesViewerComponent],
      providers: [
        { provide: TodayStoriesStore, useValue: store },
        { provide: MediaService, useValue: mediaService },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { yearsAgo: 2, initialIndex: 0 } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TodayStoriesViewerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance.toggleFavorite();
    fixture.detectChanges();

    expect(toggleFavorite).toHaveBeenCalledTimes(1);
    expect(mediaService.getFileUrl).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.activeItem()?.is_favorited).toBe(true);
  });

  it('closes after the final item in the year group completes', async () => {
    const store = createStore();
    const dialogRef = { close: vi.fn() };
    const mediaService = { getFileUrl: vi.fn(() => of('blob:file')) };

    await TestBed.configureTestingModule({
      imports: [TodayStoriesViewerComponent],
      providers: [
        { provide: TodayStoriesStore, useValue: store },
        { provide: MediaService, useValue: mediaService },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { yearsAgo: 3, initialIndex: 0 } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TodayStoriesViewerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await vi.advanceTimersByTimeAsync(IMAGE_DURATION_MS + 100);

    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('pauses and resumes video playback state and advances on end', async () => {
    const groups = signal([{
      yearsAgo: 2,
      yearsAgoLabel: '2 years ago',
      capturedDateLabel: 'April 2',
      coverItem: makeVideo('v1', '2024-04-02T12:00:00Z'),
      items: [makeVideo('v1', '2024-04-02T12:00:00Z')],
    }]);
    const store = {
      groups: computed(() => groups()),
      toggleFavorite: vi.fn(),
    };
    const dialogRef = { close: vi.fn() };
    const mediaService = { getFileUrl: vi.fn(() => of('blob:video')) };

    await TestBed.configureTestingModule({
      imports: [TodayStoriesViewerComponent],
      providers: [
        { provide: TodayStoriesStore, useValue: store },
        { provide: MediaService, useValue: mediaService },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { yearsAgo: 2, initialIndex: 0 } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TodayStoriesViewerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance.onVideoLoadedMetadata();
    fixture.componentInstance.onVideoPause();
    await vi.advanceTimersByTimeAsync(6000);

    expect(fixture.componentInstance.pausedByPlayback()).toBe(true);
    expect(dialogRef.close).not.toHaveBeenCalled();

    fixture.componentInstance.onVideoPlay();
    fixture.componentInstance.onVideoEnded();

    expect(fixture.componentInstance.pausedByPlayback()).toBe(false);
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('does not treat video-area presses as story hold interactions', async () => {
    const groups = signal([{
      yearsAgo: 2,
      yearsAgoLabel: '2 years ago',
      capturedDateLabel: 'April 2',
      coverItem: makeVideo('v1', '2024-04-02T12:00:00Z'),
      items: [makeVideo('v1', '2024-04-02T12:00:00Z')],
    }]);
    const store = {
      groups: computed(() => groups()),
      toggleFavorite: vi.fn(),
    };
    const dialogRef = { close: vi.fn() };
    const mediaService = { getFileUrl: vi.fn(() => of('blob:video')) };

    await TestBed.configureTestingModule({
      imports: [TodayStoriesViewerComponent],
      providers: [
        { provide: TodayStoriesStore, useValue: store },
        { provide: MediaService, useValue: mediaService },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { yearsAgo: 2, initialIndex: 0 } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TodayStoriesViewerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    vi.spyOn(video, 'closest').mockImplementation((selector: string) => {
      if (selector === 'video') {
        return video;
      }

      return null;
    });

    fixture.componentInstance.onHoldStart({ target: video } as unknown as PointerEvent);
    fixture.componentInstance.onHoldEnd({ target: video } as unknown as PointerEvent);

    expect(fixture.componentInstance.pausedByHold()).toBe(false);
    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});

const IMAGE_DURATION_MS = 5000;

function createStore() {
  const groups = signal([
    makeGroup(false),
    {
      yearsAgo: 3,
      yearsAgoLabel: '3 years ago',
      capturedDateLabel: 'April 2',
      coverItem: makeMedia('last', '2023-04-02T12:00:00Z'),
      items: [makeMedia('last', '2023-04-02T12:00:00Z')],
    },
  ]);

  return {
    groups: computed(() => groups()),
    toggleFavorite: vi.fn((item) => of({ ...item, is_favorited: !item.is_favorited })),
  };
}

function makeGroup(isFavorited: boolean) {
  const first = makeMedia('a', '2024-04-02T12:00:00Z', isFavorited);
  const second = makeMedia('b', '2024-04-02T08:00:00Z');
  return {
    yearsAgo: 2,
    yearsAgoLabel: '2 years ago',
    capturedDateLabel: 'April 2',
    coverItem: first,
    items: [first, second],
  };
}

function makeMedia(id: string, capturedAt: string, isFavorited = false) {
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
    uploaded_at: capturedAt,
    deleted_at: null,
    tags: [],
    ocr_text_override: null,
    is_nsfw: false,
    tagging_status: TaggingStatus.DONE,
    tagging_error: null,
    thumbnail_status: ProcessingStatus.DONE,
    poster_status: ProcessingStatus.NOT_APPLICABLE,
    ocr_text: null,
    is_favorited: isFavorited,
    favorite_count: isFavorited ? 1 : 0,
  };
}

function makeVideo(id: string, capturedAt: string) {
  return {
    ...makeMedia(id, capturedAt),
    media_type: MediaType.VIDEO,
    poster_status: ProcessingStatus.DONE,
  };
}
