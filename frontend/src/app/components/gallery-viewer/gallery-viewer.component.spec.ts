import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';

import { GalleryViewerComponent } from './gallery-viewer.component';
import { MediaClientService } from '../../services/web/media-client.service';
import { createMediaRead } from '../../testing/media-test.utils';

describe('GalleryViewerComponent', () => {
  let fixture: ComponentFixture<GalleryViewerComponent>;
  let component: GalleryViewerComponent;
  let mediaClient: { getMediaFile: ReturnType<typeof vi.fn> };
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    mediaClient = {
      getMediaFile: vi.fn()
    };

    createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:media-url');
    revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [GalleryViewerComponent],
      providers: [
        { provide: MediaClientService, useValue: mediaClient }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryViewerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });

  it('loads and renders an image when media is provided', async () => {
    const media = createMediaRead();
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mediaClient.getMediaFile).toHaveBeenCalledWith(media.id);
    expect(component.mediaUrl).toBe('blob:media-url');
    expect(fixture.nativeElement.querySelector('img.viewer-asset')).toBeTruthy();
  });

  it('renders a video player for video media', async () => {
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['video'])));

    fixture.componentRef.setInput('media', createMediaRead({
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
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('video.viewer-asset')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Duration');
  });

  it('shows a spinner instead of pending text while tagging is in progress', async () => {
    const media = createMediaRead({ tagging_status: 'pending' });
    mediaClient.getMediaFile.mockReturnValue(of(new Blob(['image'])));

    fixture.componentRef.setInput('media', media);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.viewer-status mat-spinner')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.viewer-status')?.textContent).toContain('Processing');
    expect(fixture.nativeElement.querySelector('.viewer-status')?.textContent).not.toContain('pending');
  });

  it('shows the failed state when loading the media file errors', async () => {
    mediaClient.getMediaFile.mockReturnValue(throwError(() => new Error('broken')));

    fixture.componentRef.setInput('media', createMediaRead());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

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

    fixture.componentRef.setInput('media', createMediaRead());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.close-button') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('.viewer-backdrop') as HTMLElement).click();
    component.handleEscape();

    expect(closedSpy).toHaveBeenCalledTimes(3);
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
