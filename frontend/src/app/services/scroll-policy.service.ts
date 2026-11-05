import { ViewportScroller } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, Scroll } from '@angular/router';
import { isSameFeedTransition } from './media-navigator.service';

@Injectable({ providedIn: 'root' })
export class ScrollPolicy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly viewportScroller = inject(ViewportScroller);
  private previousUrl: string | null = null;

  init(): void {
    this.viewportScroller.setHistoryScrollRestoration('manual');
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof Scroll) {
        this.apply(event);
      }
    });
  }

  private apply(event: Scroll): void {
    const url = event.routerEvent instanceof NavigationEnd
      ? event.routerEvent.urlAfterRedirects
      : event.routerEvent.url;
    const previousUrl = this.previousUrl;
    this.previousUrl = url;

    if (event.scrollBehavior === 'manual' || isSameFeedTransition(previousUrl, url)) {
      return;
    }

    if (event.position) {
      this.viewportScroller.scrollToPosition(event.position, { behavior: 'instant' });
    } else if (!event.anchor) {
      this.viewportScroller.scrollToPosition([0, 0]);
    }
  }
}
