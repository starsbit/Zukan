import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, input, output } from '@angular/core';

@Directive({
  selector: '[zukanLazyViewport]',
  standalone: true,
})
export class LazyViewportDirective implements AfterViewInit, OnDestroy {
  readonly rootMargin = input('800px 0px', { alias: 'zukanLazyViewportRootMargin' });
  readonly visible = output<void>({ alias: 'zukanLazyViewportVisible' });

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private observer?: IntersectionObserver;
  private emitted = false;

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.emitVisible();
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        this.emitVisible();
      },
      { rootMargin: this.rootMargin() },
    );
    this.observer.observe(this.element.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private emitVisible(): void {
    if (this.emitted) {
      return;
    }

    this.emitted = true;
    this.observer?.disconnect();
    this.visible.emit();
  }
}
