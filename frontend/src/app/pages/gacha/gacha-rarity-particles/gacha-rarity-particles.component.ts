import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, input, viewChild } from '@angular/core';
import type { Container, ISourceOptions } from '@tsparticles/engine';
import { tsParticles } from '@tsparticles/engine';
import { loadSlim } from '@tsparticles/slim';
import { RarityTier } from '../../../models/gacha';

export type GachaRarityParticleVariant = 'stage' | 'card' | 'inspector';

let slimLoadPromise: Promise<void> | null = null;
let particleId = 0;

function loadParticlesSlim(): Promise<void> {
  slimLoadPromise ??= loadSlim(tsParticles);
  return slimLoadPromise;
}

function isHighRarity(rarity: RarityTier | null): rarity is RarityTier.SSR | RarityTier.UR {
  return rarity === RarityTier.SSR || rarity === RarityTier.UR;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function supportsCanvas(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext?.('2d'));
  } catch {
    return false;
  }
}

@Component({
  selector: 'zukan-gacha-rarity-particles',
  standalone: true,
  templateUrl: './gacha-rarity-particles.component.html',
  styleUrl: './gacha-rarity-particles.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GachaRarityParticlesComponent implements OnDestroy {
  readonly rarity = input<RarityTier | null>(null);
  readonly active = input(false);
  readonly variant = input<GachaRarityParticleVariant>('stage');

  private readonly host = viewChild<ElementRef<HTMLElement>>('particlesHost');
  private readonly reducedMotion = prefersReducedMotion();
  private readonly instanceId = `zukan-rarity-particles-${++particleId}`;
  private container: Container | undefined;
  private currentKey = '';

  readonly shouldRender = computed(() => this.active() && isHighRarity(this.rarity()) && !this.reducedMotion);
  readonly particleClass = computed(() => [
    'rarity-particles',
    `rarity-particles--${this.variant()}`,
    `rarity-particles--${this.rarity()?.toLowerCase() ?? 'none'}`,
  ].join(' '));

  constructor() {
    effect(() => {
      const key = [
        this.rarity(),
        this.active(),
        this.variant(),
        this.shouldRender(),
        Boolean(this.host()),
      ].join(':');

      void this.syncParticles(key);
    });
  }

  private async syncParticles(key: string): Promise<void> {
    const host = this.host()?.nativeElement;
    const rarity = this.rarity();

    if (!host || !this.shouldRender() || !isHighRarity(rarity) || !supportsCanvas()) {
      this.destroyParticles();
      this.currentKey = '';
      return;
    }

    if (this.currentKey === key && this.container) {
      return;
    }

    this.destroyParticles();
    this.currentKey = key;

    await loadParticlesSlim();

    if (this.currentKey !== key || !this.shouldRender()) {
      return;
    }

    const container = await tsParticles.load({
      id: this.instanceId,
      element: host,
      options: this.optionsFor(rarity, this.variant()),
    });

    if (this.currentKey !== key || !this.shouldRender()) {
      container?.destroy();
      return;
    }

    this.container = container;
  }

  ngOnDestroy(): void {
    this.destroyParticles();
  }

  private destroyParticles(): void {
    this.container?.destroy();
    this.container = undefined;
  }

  private optionsFor(rarity: RarityTier.SSR | RarityTier.UR, variant: GachaRarityParticleVariant): ISourceOptions {
    const ur = rarity === RarityTier.UR;
    const urCard = ur && variant === 'card';
    const count = this.particleCount(rarity, variant);
    const sizeMax = variant === 'stage' ? 4.4 : variant === 'inspector' ? 3.8 : urCard ? 5.4 : 2.8;

    return {
      autoPlay: true,
      background: { color: { value: 'transparent' } },
      detectRetina: true,
      fpsLimit: variant === 'card' ? 45 : 60,
      fullScreen: { enable: false },
      interactivity: { events: { resize: { enable: true } } },
      particles: {
        color: {
          value: ur
            ? ['#ffe88a', '#ff8bd6', '#8fe8ff', '#ffffff']
            : ['#caa7ff', '#8fe8ff', '#ffffff'],
        },
        links: { enable: false },
        move: {
          direction: urCard ? 'none' : 'top',
          enable: true,
          outModes: { default: 'out' },
          random: true,
          speed: urCard ? { min: 0.05, max: 0.38 } : ur ? { min: 0.55, max: 1.45 } : { min: 0.28, max: 0.9 },
          straight: false,
        },
        number: {
          density: { enable: false },
          value: count,
        },
        opacity: {
          value: urCard ? { min: 0, max: 0.92 } : ur ? { min: 0.18, max: 0.76 } : { min: 0.12, max: 0.48 },
          animation: {
            enable: true,
            speed: urCard ? 3.6 : ur ? 1.9 : 1.2,
            startValue: 'random',
            sync: false,
          },
        },
        shape: {
          type: urCard ? 'triangle' : ['circle', 'star'],
        },
        shadow: {
          blur: urCard ? 8 : 0,
          color: '#fff7c2',
          enable: urCard,
        },
        size: {
          value: { min: 0.8, max: sizeMax },
          animation: {
            enable: true,
            speed: urCard ? 4.2 : ur ? 2.4 : 1.4,
            startValue: 'random',
            sync: false,
          },
        },
      },
      pauseOnBlur: true,
      pauseOnOutsideViewport: true,
    };
  }

  private particleCount(rarity: RarityTier.SSR | RarityTier.UR, variant: GachaRarityParticleVariant): number {
    const ur = rarity === RarityTier.UR;

    switch (variant) {
      case 'stage':
        return ur ? 68 : 36;
      case 'inspector':
        return ur ? 42 : 24;
      case 'card':
        return ur ? 34 : 12;
    }
  }
}
