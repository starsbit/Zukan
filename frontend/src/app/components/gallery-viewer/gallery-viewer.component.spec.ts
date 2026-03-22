import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GalleryViewerComponent } from './gallery-viewer.component';
import { CharacterSuggestionsService } from '../../services/character-suggestions.service';
import { MediaService } from '../../services/media.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { TagsService } from '../../services/tags.service';
import { MediaClientService } from '../../services/web/media-client.service';
import { createMediaRead } from '../../testing/media-test.utils';

describe('GalleryViewerComponent', () => {
  let fixture: ComponentFixture<GalleryViewerComponent>;
  let component: GalleryViewerComponent;
  let mediaClient: { getMediaFile: ReturnType<typeof vi.fn> };
  let mediaService: { updateMedia: ReturnType<typeof vi.fn> };
  let mediaUploadService: {
    taggingStatusByMediaId: ReturnType<typeof signal<Record<string, string>>>;
    getMediaTaggingStatus: ReturnType<typeof vi.fn>;
  };
  let tagsService: { search: ReturnType<typeof vi.fn> };
  let characterSuggestionsService: { search: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    mediaClient = {
      getMediaFile: vi.fn()
    };
    mediaService = {
      updateMedia: vi.fn()
    };
    mediaUploadService = {
      taggingStatusByMediaId: signal<Record<string, string>>({}),
      getMediaTaggingStatus: vi.fn((mediaId: string | null | undefined) => {
        if (!mediaId) {
          return null;
        }

        return mediaUploadService.taggingStatusByMediaId()[mediaId] ?? null;
      })
    };
    tagsService = {
      search: vi.fn().mockReturnValue(of([]))
    };
    characterSuggestionsService = {
      search: vi.fn().mockReturnValue(of([]))
    };
    snackBar = {
      open: vi.fn()
    };

    createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:media-url');
    revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [GalleryViewerComponent],
      providers: [
        { provide: CharacterSuggestionsService, useValue: characterSuggestionsService },
        { provide: MediaService, useValue: mediaService },
        { provide: MediaClientService, useValue: mediaClient },
        { provide: MediaUploadService, useValue: mediaUploadService },
        { provide: TagsService, useValue: tagsService },
        { provide: MatSnackBar, useValue: snackBar }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryViewerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });

  async function renderViewer(media = createMediaRead()): Promise<void> {
    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('loads and renders an image when media is provided', async () => {
    const media = createMediaRead();
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));

    await renderViewer(media);

    expect(mediaClient.getMediaFile).toHaveBeenCalledWith(media.id);
    expect(component.mediaUrl).toBe('blob:media-url');
    expect(fixture.nativeElement.querySelector('img.viewer-asset')).toBeTruthy();
  });

  it('renders a video player for video media', async () => {
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['video'])));

    await renderViewer(createMediaRead({
      media_type: 'video',
      metadata: {
        file_size: 2048,
        width: 1920,
        height: 1080,
        duration_seconds: 12,
        mime_type: 'video/mp4',
        captured_at: '2024-01-01T12:00:00.000Z'
      }
    }));

    expect(fixture.nativeElement.querySelector('video.viewer-asset')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Duration');
  });

  it('shows a spinner instead of pending text while tagging is in progress', async () => {
    const media = createMediaRead({ tagging_status: 'pending' });
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));

    await renderViewer(media);

    expect(fixture.nativeElement.querySelector('.viewer-status mat-spinner')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.viewer-status')?.textContent).toContain('Processing');
    expect(fixture.nativeElement.querySelector('.viewer-status')?.textContent).not.toContain('pending');
  });

  it('prefers the live upload status when the selected media input is stale', async () => {
    const media = createMediaRead({ tagging_status: 'pending' });
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));

    await renderViewer(media);

    mediaUploadService.taggingStatusByMediaId.set({ [media.id]: 'done' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.viewer-status mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.viewer-status')?.textContent).toContain('Done');
  });

  it('shows the failed state when loading the media file errors', async () => {
    mediaClient.getMediaFile.mockReturnValue(throwError(() => new Error('broken')));

    await renderViewer(createMediaRead());

    expect(component.failed).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('We could not load this item.');
  });

  it('resets the viewer when media becomes null', async () => {
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));

    fixture.componentRef.setInput('media', createMediaRead());
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentRef.setInput('media', null);
    fixture.detectChanges();

    expect(component.mediaUrl).toBeNull();
    expect(component.loading).toBe(false);
    expect(component.failed).toBe(false);
  });

  it('ignores stale media responses after a newer request starts', async () => {
    const firstRequest = new Subject<Blob>();
    const secondMedia = createMediaRead({ id: 'media-2' });

    mediaClient.getMediaFile
      .mockReturnValueOnce(firstRequest.asObservable())
      .mockReturnValueOnce(of(new Blob(['latest'])));

    fixture.componentRef.setInput('media', createMediaRead());
    fixture.detectChanges();

    fixture.componentRef.setInput('media', secondMedia);
    fixture.detectChanges();
    await fixture.whenStable();

    firstRequest.next(new Blob(['stale']));
    firstRequest.complete();

    expect(mediaClient.getMediaFile).toHaveBeenNthCalledWith(2, secondMedia.id);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
  });

  it('emits close when the backdrop, button, or escape key are used', async () => {
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));
    const closedSpy = vi.fn();
    component.closed.subscribe(closedSpy);

    await renderViewer(createMediaRead());

    (fixture.nativeElement.querySelector('button[aria-label="Close viewer"]') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('.viewer-backdrop') as HTMLElement).click();
    component.handleEscape();

    expect(closedSpy).toHaveBeenCalledTimes(3);
  });

  it('closes when clicking empty viewer space but not when clicking the image or sidebar', async () => {
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));
    const closedSpy = vi.fn();
    component.closed.subscribe(closedSpy);

    await renderViewer(createMediaRead({ tags: ['fox'] }));

    (fixture.nativeElement.querySelector('.viewer-media') as HTMLElement).click();
    fixture.detectChanges();

    expect(closedSpy).toHaveBeenCalledTimes(1);

    (fixture.nativeElement.querySelector('img.viewer-asset') as HTMLImageElement).click();
    fixture.detectChanges();

    expect(closedSpy).toHaveBeenCalledTimes(1);

    (fixture.nativeElement.querySelector('button[aria-label="Show tags panel"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.viewer-sidebar') as HTMLElement).click();

    expect(closedSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the viewer open when the toolbar is clicked', async () => {
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));
    const closedSpy = vi.fn();
    component.closed.subscribe(closedSpy);

    await renderViewer(createMediaRead());

    (fixture.nativeElement.querySelector('.viewer-toolbar') as HTMLElement).click();

    expect(closedSpy).not.toHaveBeenCalled();
  });

  it('keeps the viewer open when the loading or failed state is clicked', async () => {
    const closedSpy = vi.fn();
    component.closed.subscribe(closedSpy);

    mediaClient.getMediaFile.mockReturnValue(new Subject<Blob>().asObservable());
    fixture.componentRef.setInput('media', createMediaRead());
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.viewer-state') as HTMLElement).click();
    expect(closedSpy).not.toHaveBeenCalled();

    mediaClient.getMediaFile.mockReturnValue(throwError(() => new Error('broken')));
    await renderViewer(createMediaRead({ id: 'failed-media' }));

    (fixture.nativeElement.querySelector('.viewer-state') as HTMLElement).click();
    expect(closedSpy).not.toHaveBeenCalled();
  });

  it('keeps the viewer open when the video element is clicked', async () => {
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['video'])));
    const closedSpy = vi.fn();
    component.closed.subscribe(closedSpy);

    await renderViewer(createMediaRead({
      media_type: 'video',
      metadata: {
        file_size: 2048,
        width: 1920,
        height: 1080,
        duration_seconds: 12,
        mime_type: 'video/mp4',
        captured_at: '2024-01-01T12:00:00.000Z'
      }
    }));

    (fixture.nativeElement.querySelector('video.viewer-asset') as HTMLVideoElement).click();

    expect(closedSpy).not.toHaveBeenCalled();
  });

  it('uses a translucent backdrop', async () => {
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));

    await renderViewer(createMediaRead());

    const styleText = Array.from(document.head.querySelectorAll('style'))
      .map((styleElement) => styleElement.textContent ?? '')
      .join('\n');

    expect(styleText).toContain('color-mix(in srgb,var(--mat-sys-scrim) 62%,transparent)');
  });

  it('opens the tags sidebar from the toolbar', async () => {
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));

    await renderViewer(createMediaRead({ tags: ['fox', 'blue_eyes', 'smile'], character_name: 'ikari_shinji' }));

    expect(fixture.nativeElement.querySelector('.viewer-shell-sidebar-open')).toBeNull();

    (fixture.nativeElement.querySelector('button[aria-label="Show tags panel"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(component.tagsPanelOpen).toBe(true);
    expect(fixture.nativeElement.querySelector('.viewer-shell-sidebar-open')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('mat-card.viewer-sidebar-card')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('mat-chip-set.viewer-tags')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Fox');
    expect(fixture.nativeElement.textContent).toContain('Blue Eyes');
    expect(fixture.nativeElement.textContent).toContain('Ikari Shinji');
  });

  it('emits delete when the delete action is used', async () => {
    const media = createMediaRead();
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));
    const deleteSpy = vi.fn();
    component.deleteRequested.subscribe(deleteSpy);

    fixture.componentRef.setInput('media', media);
    fixture.componentRef.setInput('canDelete', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button[aria-label="Delete media"]') as HTMLButtonElement).click();

    expect(deleteSpy).toHaveBeenCalledWith(media);
  });

  it('lets the user edit tags and character details for images', async () => {
    const media = createMediaRead({ tags: ['fox'], character_name: null });
    const updatedMedia = createMediaRead({ tags: ['fox', 'hero'], character_name: 'ikari_shinji' });
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));
    mediaService.updateMedia.mockReturnValue(of(updatedMedia));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button[aria-label="Show tags panel"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button[aria-label="Edit tags and character"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const characterInput = fixture.nativeElement.querySelector('input[aria-label="Character name"]') as HTMLInputElement;
    characterInput.value = 'ikari_shinji';
    characterInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const tagInput = fixture.nativeElement.querySelector('input[aria-label="Add tag"]') as HTMLInputElement;
    tagInput.value = 'hero';
    tagInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button[aria-label="Add current tag"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.viewer-edit-actions button:last-child') as HTMLButtonElement).click();

    expect(mediaService.updateMedia).toHaveBeenCalledWith(media.id, {
      character_name: 'ikari_shinji',
      tags: ['fox', 'hero']
    });
    expect(component.editingMetadata).toBe(false);
    expect(component.media?.character_name).toBe('ikari_shinji');
    expect(component.media?.tags).toEqual(['fox', 'hero']);
  });

  it('loads character and tag suggestions while editing metadata', async () => {
    vi.useFakeTimers();

    try {
      mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));
      characterSuggestionsService.search.mockReturnValue(of([{ name: 'rei', media_count: 2 }]));
      tagsService.search.mockReturnValue(of([{ id: 1, name: 'fox', category: 0, category_name: 'general', media_count: 2 }]));

      fixture.componentRef.setInput('media', createMediaRead({ tags: [] }));
      fixture.detectChanges();
      await fixture.whenStable();
      (fixture.nativeElement.querySelector('button[aria-label="Show tags panel"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('button[aria-label="Edit tags and character"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      const characterInput = fixture.nativeElement.querySelector('input[aria-label="Character name"]') as HTMLInputElement;
      characterInput.value = 're';
      characterInput.dispatchEvent(new Event('input'));

      const tagInput = fixture.nativeElement.querySelector('input[aria-label="Add tag"]') as HTMLInputElement;
      tagInput.value = 'fo';
      tagInput.dispatchEvent(new Event('input'));

      await vi.advanceTimersByTimeAsync(250);
      fixture.detectChanges();

      expect(characterSuggestionsService.search).toHaveBeenCalledWith('re', 6);
      expect(tagsService.search).toHaveBeenCalledWith({ q: 'fo', limit: 8 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('zooms images with the mouse wheel and resets pan when zoom returns to one', async () => {
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));

    fixture.componentRef.setInput('media', createMediaRead());
    fixture.detectChanges();
    await fixture.whenStable();

    const preventDefault = vi.fn();
    component.onWheelZoom({ deltaY: -120, preventDefault } as unknown as WheelEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(component.zoom).toBeGreaterThan(1);

    component.resetZoom();

    expect(component.zoom).toBe(1);
    expect(component.panX).toBe(0);
    expect(component.panY).toBe(0);
  });

  it('emits restore when the trash action is used', async () => {
    const media = createMediaRead({ deleted_at: '2026-03-21T00:00:00Z' });
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));
    const restoreSpy = vi.fn();
    component.restoreRequested.subscribe(restoreSpy);

    fixture.componentRef.setInput('media', media);
    fixture.componentRef.setInput('canRestore', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button[aria-label="Restore media"]') as HTMLButtonElement).click();

    expect(restoreSpy).toHaveBeenCalledWith(media);
  });

  it('revokes the object URL on destroy', async () => {
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));

    fixture.componentRef.setInput('media', createMediaRead());
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.destroy();

    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:media-url');
  });
});
