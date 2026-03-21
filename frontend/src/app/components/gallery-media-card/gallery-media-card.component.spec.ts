import '@angular/compiler';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GalleryMediaCardComponent } from './gallery-media-card.component';
import { MediaUploadService } from '../../services/media-upload.service';
import { MediaClientService } from '../../services/web/media-client.service';
import { createMediaRead } from '../../testing/media-test.utils';

describe('GalleryMediaCardComponent', () => {
  let fixture: ComponentFixture<GalleryMediaCardComponent>;
  let component: GalleryMediaCardComponent;
  let mediaClient: {
    getMediaThumbnail: ReturnType<typeof vi.fn>;
    getMediaFile: ReturnType<typeof vi.fn>;
  };
  let mediaUploadService: {
    getMediaTaggingStatus: ReturnType<typeof vi.fn>;
    taggingStatusByMediaId: ReturnType<typeof signal<Record<string, string>>>;
  };
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let playSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    mediaClient = {
      getMediaThumbnail: vi.fn(),
      getMediaFile: vi.fn()
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

    createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb-url');
    revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [GalleryMediaCardComponent],
      providers: [
        { provide: MediaClientService, useValue: mediaClient },
        { provide: MediaUploadService, useValue: mediaUploadService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryMediaCardComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it('loads and renders the thumbnail when it is available', async () => {
    const media = createMediaRead();
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mediaClient.getMediaThumbnail).toHaveBeenCalledWith(media.id);
    expect(component.thumbnailUrl).toBe('blob:thumb-url');
    expect(component.loadingThumbnail).toBe(false);
    expect(component.thumbnailFailed).toBe(false);
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('blob:thumb-url');
  });

  it('shows a fallback state when the thumbnail is not ready', async () => {
    const media = createMediaRead({ thumbnail_status: 'processing' });

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mediaClient.getMediaThumbnail).not.toHaveBeenCalled();
    expect(component.thumbnailFailed).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('image');
  });

  it('uses the media aspect ratio on the card surface for landscape tiles', () => {
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));

    fixture.componentRef.setInput('media', createMediaRead({
      metadata: { ...createMediaRead().metadata, width: 1600, height: 900 }
    }));
    fixture.detectChanges();

    expect(component.aspectRatio).toBeCloseTo(1600 / 900);
    expect(fixture.nativeElement.querySelector('.media-card')).toBeTruthy();
  });

  it('uses the media aspect ratio on the card surface for portrait tiles', () => {
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));

    fixture.componentRef.setInput('media', createMediaRead({
      metadata: { ...createMediaRead().metadata, width: 700, height: 1200 }
    }));
    fixture.detectChanges();

    expect(component.aspectRatio).toBeCloseTo(700 / 1200);
    expect(fixture.nativeElement.querySelector('.media-card')).toBeTruthy();
  });

  it('shows a compact spinner badge while tagging is pending', async () => {
    const media = createMediaRead({ tagging_status: 'pending' });
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.status-badge mat-spinner')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.status-badge')?.textContent).toContain('Pending');
  });

  it('shows a compact spinner badge while tagging is processing', async () => {
    const media = createMediaRead({ tagging_status: 'processing' });
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.status-badge mat-spinner')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.status-badge')?.textContent).toContain('Processing');
  });

  it('shows a video badge with duration', async () => {
    const media = createMediaRead({
      media_type: 'video',
      metadata: { ...createMediaRead().metadata, mime_type: 'video/mp4', duration_seconds: 120 }
    });
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.media-type-badge')?.textContent).toContain('02:00');
    expect(fixture.nativeElement.querySelector('.media-type-badge mat-icon')?.textContent).toContain('play_circle');
  });

  it('shows a gif badge', async () => {
    const media = createMediaRead({
      media_type: 'gif',
      filename: 'loop.gif',
      metadata: { ...createMediaRead().metadata, mime_type: 'image/gif' }
    });
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.media-type-badge')?.textContent).toContain('GIF');
    expect(fixture.nativeElement.querySelector('.media-type-badge mat-icon')?.textContent).toContain('gif_box');
  });

  it('prefers the live upload tagging status without replacing the media input', async () => {
    const media = createMediaRead({ tagging_status: 'done' });
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();

    mediaUploadService.taggingStatusByMediaId.set({ [media.id]: 'processing' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.status-badge')?.textContent).toContain('Processing');
  });

  it('hides the badge when the live upload status is done even if the media input is stale', async () => {
    const media = createMediaRead({ tagging_status: 'pending' });
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();

    mediaUploadService.taggingStatusByMediaId.set({ [media.id]: 'done' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.status-badge')).toBeNull();
  });

  it('marks thumbnail loading as failed when the request errors', async () => {
    mediaClient.getMediaThumbnail.mockReturnValue(throwError(() => new Error('broken')));

    fixture.componentRef.setInput('media', createMediaRead());
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.loadingThumbnail).toBe(false);
    expect(component.thumbnailFailed).toBe(true);
  });

  it('ignores stale thumbnail responses after the media input changes', async () => {
    const firstRequest = new Subject<Blob>();
    const secondMedia = createMediaRead({ id: 'media-2', filename: 'new-image.png' });

    mediaClient.getMediaThumbnail
      .mockReturnValueOnce(firstRequest.asObservable())
      .mockReturnValueOnce(of(new Blob(['fresh'])));

    fixture.componentRef.setInput('media', createMediaRead());
    fixture.detectChanges();

    fixture.componentRef.setInput('media', secondMedia);
    fixture.detectChanges();
    await fixture.whenStable();

    firstRequest.next(new Blob(['stale']));
    firstRequest.complete();

    expect(component.thumbnailUrl).toBe('blob:thumb-url');
    expect(mediaClient.getMediaThumbnail).toHaveBeenNthCalledWith(2, secondMedia.id);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the current thumbnail when the same media refreshes with a new object reference', async () => {
    const media = createMediaRead();
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentRef.setInput('media', { ...media, tags: ['fox', 'wolf'] });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mediaClient.getMediaThumbnail).toHaveBeenCalledTimes(1);
    expect(component.thumbnailUrl).toBe('blob:thumb-url');
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();
  });

  it('emits the selected media when opened', async () => {
    const media = createMediaRead();
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));
    const openSpy = vi.fn();
    component.open.subscribe(openSpy);

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();

    (fixture.nativeElement.querySelector('.media-card') as HTMLElement).click();

    expect(openSpy).toHaveBeenCalledWith(media);
  });

  it('shows the selection control and pressed state when selected', async () => {
    const media = createMediaRead();
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));

    fixture.componentRef.setInput('media', media);
    fixture.componentRef.setInput('selectionMode', true);
    fixture.componentRef.setInput('selected', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.selection-toggle') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toContain('check_circle');
  });

  it('emits selection toggles from the circle without opening the media', async () => {
    const media = createMediaRead();
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));
    const toggleSpy = vi.fn();
    const openSpy = vi.fn();
    component.selectionToggled.subscribe(toggleSpy);
    component.open.subscribe(openSpy);

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();

    (fixture.nativeElement.querySelector('.selection-toggle') as HTMLButtonElement).click();

    expect(toggleSpy).toHaveBeenCalledWith(media);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('emits restore requests from the trash action without opening the media', async () => {
    const media = createMediaRead({ deleted_at: '2026-03-21T00:00:00Z' });
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));
    const restoreSpy = vi.fn();
    const openSpy = vi.fn();
    component.restoreRequested.subscribe(restoreSpy);
    component.open.subscribe(openSpy);

    fixture.componentRef.setInput('media', media);
    fixture.componentRef.setInput('trashMode', true);
    fixture.detectChanges();
    await fixture.whenStable();

    (fixture.nativeElement.querySelector('.restore-button') as HTMLButtonElement).click();

    expect(restoreSpy).toHaveBeenCalledWith(media);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('loads a video preview on hover and renders a muted looping player', async () => {
    const media = createMediaRead({
      media_type: 'video',
      metadata: { ...createMediaRead().metadata, mime_type: 'video/mp4', duration_seconds: 45 }
    });
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['video'], { type: 'video/mp4' })));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();

    component.onPreviewEnter();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mediaClient.getMediaFile).toHaveBeenCalledWith(media.id);
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement | null;
    expect(video).toBeTruthy();
    video?.dispatchEvent(new Event('canplay'));
    fixture.detectChanges();

    expect(component.previewReady).toBe(false);
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(playSpy).toHaveBeenCalled();

    video?.dispatchEvent(new Event('playing'));
    fixture.detectChanges();

    expect(component.previewReady).toBe(true);
  });

  it('loads a gif preview on hover and removes it when hover ends', async () => {
    const media = createMediaRead({
      media_type: 'gif',
      filename: 'loop.gif',
      metadata: { ...createMediaRead().metadata, mime_type: 'image/gif' }
    });
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['gif'])));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();

    component.onPreviewEnter();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.media-preview-image')).toBeTruthy();

    component.onPreviewLeave();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.media-preview-image')).toBeNull();
  });

  it('toggles selection from the card surface while selection mode is active', async () => {
    const media = createMediaRead();
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));
    const toggleSpy = vi.fn();
    const openSpy = vi.fn();
    component.selectionToggled.subscribe(toggleSpy);
    component.open.subscribe(openSpy);

    fixture.componentRef.setInput('media', media);
    fixture.componentRef.setInput('selectionMode', true);
    fixture.detectChanges();
    await fixture.whenStable();

    (fixture.nativeElement.querySelector('.media-card') as HTMLElement).click();

    expect(toggleSpy).toHaveBeenCalledWith(media);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('uses metadata aspect ratio and revokes object URLs on destroy', async () => {
    mediaClient.getMediaThumbnail.mockReturnValue(of(new Blob(['thumb'])));

    fixture.componentRef.setInput('media', createMediaRead({
      metadata: {
        file_size: 2048,
        width: 1920,
        height: 1080,
        mime_type: 'image/png',
        captured_at: '2024-01-01T12:00:00.000Z'
      }
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.aspectRatio).toBeCloseTo(1920 / 1080);
    expect(fixture.nativeElement.querySelector('.media-card')).toBeTruthy();

    fixture.destroy();

    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:thumb-url');
  });
});
