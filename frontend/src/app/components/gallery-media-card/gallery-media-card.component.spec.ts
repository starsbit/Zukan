import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';

import { GalleryMediaCardComponent } from './gallery-media-card.component';
import { MediaClientService } from '../../services/web/media-client.service';
import { createMediaRead } from '../../testing/media-test.utils';

describe('GalleryMediaCardComponent', () => {
  let fixture: ComponentFixture<GalleryMediaCardComponent>;
  let component: GalleryMediaCardComponent;
  let mediaClient: { getMediaThumbnail: ReturnType<typeof vi.fn> };
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    mediaClient = {
      getMediaThumbnail: vi.fn()
    };

    createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb-url');
    revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [GalleryMediaCardComponent],
      providers: [
        { provide: MediaClientService, useValue: mediaClient }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryMediaCardComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
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
    expect(fixture.nativeElement.textContent).toContain('Image');
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

  it('computes the aspect ratio from metadata and revokes object URLs on destroy', async () => {
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

    fixture.destroy();

    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:thumb-url');
  });
});
