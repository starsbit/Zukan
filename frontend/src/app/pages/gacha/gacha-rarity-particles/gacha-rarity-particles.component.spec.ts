import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { RarityTier } from '../../../models/gacha';
import { GachaRarityParticlesComponent, GachaRarityParticleVariant } from './gacha-rarity-particles.component';

describe('GachaRarityParticlesComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('renders only for active SSR and UR rarities', async () => {
    const fixture = await createComponent(RarityTier.UR, true);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.rarity-particles--ur')).not.toBeNull();

    fixture.componentRef.setInput('rarity', RarityTier.SSR);
    fixture.detectChanges();
    expect(element.querySelector('.rarity-particles--ssr')).not.toBeNull();

    fixture.componentRef.setInput('rarity', RarityTier.SR);
    fixture.detectChanges();
    expect(element.querySelector('.rarity-particles')).toBeNull();

    fixture.componentRef.setInput('rarity', RarityTier.UR);
    fixture.componentRef.setInput('active', false);
    fixture.detectChanges();
    expect(element.querySelector('.rarity-particles')).toBeNull();
  });

  it('does not render when reduced motion is preferred', async () => {
    vi.stubGlobal('window', {
      ...window,
      matchMedia: vi.fn(() => ({ matches: true })),
    });

    const fixture = await createComponent(RarityTier.UR, true);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.rarity-particles')).toBeNull();
  });
});

async function createComponent(
  rarity: RarityTier | null,
  active: boolean,
  variant: GachaRarityParticleVariant = 'card',
) {
  await TestBed.configureTestingModule({
    imports: [GachaRarityParticlesComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(GachaRarityParticlesComponent);
  fixture.componentRef.setInput('rarity', rarity);
  fixture.componentRef.setInput('active', active);
  fixture.componentRef.setInput('variant', variant);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}
