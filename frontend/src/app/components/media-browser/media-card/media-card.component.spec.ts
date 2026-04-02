import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaRead, MediaType, MediaVisibility, ProcessingStatus, TaggingStatus } from '../../../models/media';
import { MediaService } from '../../../services/media.service';
import { MediaCardComponent } from './media-card.component';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  trigger(isIntersecting = true): void {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function makeMedia(overrides: Partial<MediaRead> = {}): MediaRead {
  const media: MediaRead = {
    id: 'm1',
    uploader_id: 'u1',
    uploader_username: 'uploader',
    owner_id: 'u1',
    owner_username: 'owner',
    visibility: MediaVisibility.PRIVATE,
    filename: 'media.jpg',
    original_filename: null,
    media_type: MediaType.IMAGE,
    metadata: {
      file_size: 10,
      width: 400,
      height: 300,
      duration_seconds: null,
      frame_count: null,
      mime_type: 'image/jpeg',
      captured_at: '2026-03-28T12:00:00Z',
    },
    version: 1,
    created_at: '2026-03-28T12:00:00Z',
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

  return {
    ...media,
    ...overrides,
    favorite_count: overrides.favorite_count ?? media.favorite_count,
  };
}

describe('MediaCardComponent', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });

  it('waits for viewport entry before fetching the preview', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia());
    fixture.detectChanges();

    expect(mediaService.getThumbnailUrl).not.toHaveBeenCalled();

    FakeIntersectionObserver.instances[0].trigger();
    fixture.detectChanges();

    expect(mediaService.getThumbnailUrl).toHaveBeenCalledWith('m1');
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('blob:thumb');
  });

  it('uses poster previews for videos', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia({
      id: 'video-1',
      media_type: MediaType.VIDEO,
      poster_status: ProcessingStatus.DONE,
      thumbnail_status: ProcessingStatus.DONE,
    }));
    fixture.detectChanges();

    FakeIntersectionObserver.instances[0].trigger();
    fixture.detectChanges();

    expect(mediaService.getPosterUrl).toHaveBeenCalledWith('video-1');
    expect(mediaService.getThumbnailUrl).not.toHaveBeenCalled();
  });

  it('loads GIF animation only when hovered after it becomes visible', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:animated')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia({
      media_type: MediaType.GIF,
    }));
    fixture.detectChanges();

    FakeIntersectionObserver.instances[0].trigger();
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.media-card') as HTMLElement;
    card.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    expect(mediaService.getFileUrl).toHaveBeenCalledWith('m1');
  });

  it('loads the original video and renders a muted looping preview on hover', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:video')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia({
      id: 'video-1',
      media_type: MediaType.VIDEO,
      poster_status: ProcessingStatus.DONE,
    }));
    fixture.detectChanges();

    FakeIntersectionObserver.instances[0].trigger();
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.media-card') as HTMLElement;
    card.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    expect(mediaService.getFileUrl).toHaveBeenCalledWith('video-1');
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
  });

  it('does not refetch after the card has already loaded once', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia());
    fixture.detectChanges();

    FakeIntersectionObserver.instances[0].trigger();
    FakeIntersectionObserver.instances[0].trigger();
    fixture.detectChanges();

    expect(mediaService.getThumbnailUrl).toHaveBeenCalledTimes(1);
  });

  it('renders a client preview immediately for optimistic media', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia({
      thumbnail_status: ProcessingStatus.PENDING,
      client_preview_url: 'blob:local-preview',
      client_is_optimistic: true,
    }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('blob:local-preview');
    expect(mediaService.getThumbnailUrl).not.toHaveBeenCalled();
  });

  it('shows a public icon only for public media', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia({ visibility: MediaVisibility.PUBLIC }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[aria-label="Public"]')).toBeNull();

    const card = fixture.nativeElement.querySelector('.media-card') as HTMLElement;
    card.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[aria-label="Public"]')).not.toBeNull();

    fixture.componentRef.setInput('media', makeMedia({ visibility: MediaVisibility.PRIVATE }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[aria-label="Public"]')).toBeNull();
  });

  it('shows the processing spinner while tagging is pending', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia({
      tagging_status: TaggingStatus.PENDING,
      thumbnail_status: ProcessingStatus.DONE,
      poster_status: ProcessingStatus.NOT_APPLICABLE,
    }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[aria-label="Processing"]')).not.toBeNull();
  });

  it('shows the selection control on hover when selectable', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia());
    fixture.componentRef.setInput('selectable', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.media-card__selection-button')).toBeNull();

    const card = fixture.nativeElement.querySelector('.media-card') as HTMLElement;
    card.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.media-card__selection-button')).not.toBeNull();
  });

  it('keeps the selection control visible while selection mode is active', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia());
    fixture.componentRef.setInput('selectable', true);
    fixture.componentRef.setInput('selectionMode', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.media-card__selection-button')).not.toBeNull();
  });

  it('emits selectionToggled from the selection button', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia());
    fixture.componentRef.setInput('selectable', true);
    fixture.componentRef.setInput('selectionMode', true);
    fixture.detectChanges();

    let toggled: MediaRead | null = null;
    fixture.componentInstance.selectionToggled.subscribe((media) => {
      toggled = media;
    });

    (fixture.nativeElement.querySelector('.media-card__selection-button') as HTMLButtonElement).click();

    expect((toggled as MediaRead | null)?.id).toBe('m1');
  });

  it('emits favoriteToggled when the favorite button is clicked', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia({ is_favorited: false }));
    fixture.componentRef.setInput('showFavorite', true);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.media-card') as HTMLElement;
    card.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    let emitted: MediaRead | null = null;
    fixture.componentInstance.favoriteToggled.subscribe((m) => { emitted = m; });

    const btn = fixture.nativeElement.querySelector('.media-card__favorite-button') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.click();

    expect((emitted as MediaRead | null)?.id).toBe('m1');
  });

  it('only renders the favorite button while hovered or focused', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia({ favorite_count: 4 }));
    fixture.componentRef.setInput('showFavorite', true);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.media-card') as HTMLElement;
    expect(fixture.nativeElement.querySelector('.media-card__favorite-button')).toBeNull();

    card.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.media-card__favorite-button')).not.toBeNull();

    card.dispatchEvent(new Event('mouseleave'));
    card.dispatchEvent(new FocusEvent('focusin'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.media-card__favorite-button')).not.toBeNull();
  });

  it('does not emit activated when the favorite button is clicked', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia());
    fixture.componentRef.setInput('showFavorite', true);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.media-card') as HTMLElement;
    card.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    let activated: MediaRead | null = null;
    fixture.componentInstance.activated.subscribe((m) => { activated = m; });

    (fixture.nativeElement.querySelector('.media-card__favorite-button') as HTMLButtonElement).click();

    expect(activated).toBeNull();
  });

  it('shows filled heart when media is already favorited', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia({ is_favorited: true }));
    fixture.componentRef.setInput('showFavorite', true);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.media-card') as HTMLElement;
    card.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('.media-card__favorite-button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.querySelector('mat-icon')?.textContent?.trim()).toBe('favorite');
  });

  it('toggles selection on card click while in selection mode', async () => {
    const mediaService = {
      getThumbnailUrl: vi.fn(() => of('blob:thumb')),
      getPosterUrl: vi.fn(() => of('blob:poster')),
      getFileUrl: vi.fn(() => of('blob:file')),
    };

    await TestBed.configureTestingModule({
      imports: [MediaCardComponent],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MediaCardComponent);
    fixture.componentRef.setInput('media', makeMedia());
    fixture.componentRef.setInput('selectionMode', true);
    fixture.detectChanges();

    let toggled: MediaRead | null = null;
    let activated: MediaRead | null = null;
    fixture.componentInstance.selectionToggled.subscribe((media) => {
      toggled = media;
    });
    fixture.componentInstance.activated.subscribe((media) => {
      activated = media;
    });

    (fixture.nativeElement.querySelector('.media-card') as HTMLElement).click();

    expect((toggled as MediaRead | null)?.id).toBe('m1');
    expect(activated).toBeNull();
  });
});
