import { Location } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

export interface ParsedMediaUrl {
  feedPath: string | null;
  mediaId: string | null;
  query: string;
}

interface MediaEntryState {
  mediaDepth?: number;
  mediaEntryKey?: string;
}

const DEFAULT_FEED_PATH = '/gallery';

export function parseMediaUrl(url: string): ParsedMediaUrl {
  const [withoutFragment = ''] = url.split('#');
  const [path = '', query = ''] = withoutFragment.split('?');
  const segments = path.split('/').filter(Boolean);
  const isDetail = segments.length >= 2 && segments[segments.length - 2] === 'media';

  if (!isDetail) {
    return {
      feedPath: segments.length === 0 ? DEFAULT_FEED_PATH : `/${segments.join('/')}`,
      mediaId: null,
      query,
    };
  }

  const feedSegments = segments.slice(0, -2);
  return {
    feedPath: feedSegments.length === 0 ? null : `/${feedSegments.join('/')}`,
    mediaId: segments[segments.length - 1] ?? null,
    query,
  };
}

export function isSameFeedTransition(previousUrl: string | null, nextUrl: string): boolean {
  if (previousUrl === null) {
    return false;
  }

  const previous = parseMediaUrl(previousUrl);
  const next = parseMediaUrl(nextUrl);
  return (
    (previous.mediaId !== null || next.mediaId !== null) &&
    previous.feedPath === next.feedPath &&
    previous.query === next.query
  );
}

@Injectable({ providedIn: 'root' })
export class MediaNavigator {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private nextEntryId = 1;

  readonly lastViewedId = signal<string | null>(null);

  depth(): number {
    return this.readState().mediaDepth ?? 0;
  }

  entryKey(): string | null {
    return this.readState().mediaEntryKey ?? null;
  }

  feedPath(): string | null {
    return parseMediaUrl(this.router.url).feedPath;
  }

  open(mediaId: string): void {
    this.navigateToMedia(mediaId, { mediaDepth: 1, mediaEntryKey: this.createEntryKey() });
  }

  openRelated(mediaId: string): void {
    this.navigateToMedia(mediaId, {
      mediaDepth: this.depth() + 1,
      mediaEntryKey: this.createEntryKey(),
    });
  }

  step(mediaId: string): void {
    this.navigateToMedia(mediaId, this.readState(), true);
  }

  close(): void {
    const depth = this.depth();
    if (depth > 0) {
      this.location.historyGo(-depth);
      return;
    }

    void this.router.navigate([this.feedPath() ?? DEFAULT_FEED_PATH], {
      queryParamsHandling: 'preserve',
      replaceUrl: true,
    });
  }

  private navigateToMedia(mediaId: string, state: MediaEntryState, replaceUrl = false): void {
    const feedPath = this.feedPath();
    const commands = feedPath ? [feedPath, 'media', mediaId] : ['/media', mediaId];
    void this.router.navigate(commands, {
      queryParamsHandling: 'preserve',
      replaceUrl,
      state: {
        mediaDepth: state.mediaDepth ?? 0,
        mediaEntryKey: state.mediaEntryKey ?? this.createEntryKey(),
      },
    });
  }

  private readState(): MediaEntryState {
    return (this.location.getState() as MediaEntryState | null) ?? {};
  }

  private createEntryKey(): string {
    return `${Date.now().toString(36)}-${this.nextEntryId++}`;
  }
}
