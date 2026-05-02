import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type forceAtlas2Default from 'graphology-layout-forceatlas2';
import type SigmaDefault from 'sigma';
import { CharacterGraphResponse } from '../../models/character-graph';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { MediaService } from '../../services/media.service';
import { CharacterGraphClientService } from '../../services/web/character-graph-client.service';
import { CharacterGraphPageComponent } from './character-graph.component';

const graphMocks = vi.hoisted(() => {
  const forceAtlas2 = Object.assign(vi.fn(), {
    assign: vi.fn(),
    inferSettings: vi.fn(() => ({})),
  });

  class SigmaMock {
    on = vi.fn();
    refresh = vi.fn();
    kill = vi.fn();
    getCamera(): { animate: ReturnType<typeof vi.fn> } {
      return { animate: vi.fn() };
    }
  }

  return { forceAtlas2, SigmaMock };
});

vi.mock(import('graphology-layout-forceatlas2'), () => ({
  default: graphMocks.forceAtlas2 as unknown as typeof forceAtlas2Default,
  inferSettings: graphMocks.forceAtlas2.inferSettings,
}));

vi.mock(import('sigma'), () => ({
  default: graphMocks.SigmaMock as unknown as typeof SigmaDefault,
}));

@Component({
  selector: 'zukan-layout',
  standalone: true,
  template: '<ng-content></ng-content>',
})
class StubLayoutComponent {}

const graphResponse: CharacterGraphResponse = {
  model_version: 'clip_onnx_v1',
  total_characters_considered: 2,
  center_entity_id: null,
  nodes: [
    {
      id: 'c1',
      name: 'Saber',
      media_count: 5,
      embedding_support: 5,
      series_names: ['fate'],
      representative_media_ids: ['m1'],
    },
    {
      id: 'c2',
      name: 'Rin Tohsaka',
      media_count: 4,
      embedding_support: 4,
      series_names: ['fate'],
      representative_media_ids: [],
    },
  ],
  edges: [
    {
      id: 'c1:c2',
      source: 'c1',
      target: 'c2',
      similarity: 0.9,
      shared_series: ['fate'],
    },
  ],
};

describe('CharacterGraphPageComponent', () => {
  let fixture: ComponentFixture<CharacterGraphPageComponent>;
  let graphClient: { getCharacterGraph: ReturnType<typeof vi.fn>; searchCharacters: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    graphClient = {
      getCharacterGraph: vi.fn(() => of(graphResponse)),
      searchCharacters: vi.fn(() => of([{ id: 'c1', name: 'Saber', media_count: 5 }])),
    };
    router = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [CharacterGraphPageComponent],
      providers: [
        provideNoopAnimations(),
        { provide: CharacterGraphClientService, useValue: graphClient },
        { provide: MediaService, useValue: { getThumbnailUrl: vi.fn(() => of('blob:thumb')) } },
        { provide: Router, useValue: router },
      ],
    })
      .overrideComponent(CharacterGraphPageComponent, {
        remove: { imports: [LayoutComponent] },
        add: { imports: [StubLayoutComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CharacterGraphPageComponent);
    fixture.detectChanges();
  });

  it('loads the default graph on first render', () => {
    expect(graphClient.getCharacterGraph).toHaveBeenCalledWith({
      center_entity_id: undefined,
      limit: 80,
      min_similarity: 0,
      series_mode: 'any',
      sample_size: 6,
    });
    expect(fixture.componentInstance.graphData()?.nodes.length).toBe(2);
  });

  it('selecting an autocomplete result already in the graph is client-side', () => {
    fixture.componentInstance.onSuggestionSelected({
      option: { value: { id: 'c1', name: 'Saber', media_count: 5 } },
    } as never);

    expect(graphClient.getCharacterGraph).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.selectedNodeId()).toBe('c1');
  });

  it('changing similarity filters edges on the client without refetching', () => {
    fixture.componentInstance.minSimilarityControl.setValue(0.95);
    fixture.detectChanges();

    expect(graphClient.getCharacterGraph).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.graphData()?.edges).toEqual([]);
  });

  it('shows a node color legend', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Legend');
    expect(text).toContain('Character');
    expect(text).toContain('Has series metadata');
    expect(text).toContain('Selected character');
    expect(text).toContain('Direct neighbor');
    expect(text).toContain('Outside selection');
  });

  it('center graph here builds a local selected-neighborhood view', () => {
    fixture.componentInstance.selectedNodeId.set('c1');

    fixture.componentInstance.centerOnSelected();

    expect(graphClient.getCharacterGraph).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.centeredGraphNodeId()).toBe('c1');
    expect(fixture.componentInstance.graphData()?.nodes.map((node) => node.id)).toEqual(['c1', 'c2']);
  });

  it('opens existing gallery search for the selected character', () => {
    fixture.componentInstance.selectedNodeId.set('c1');

    fixture.componentInstance.openMediaSearch();

    expect(router.navigate).toHaveBeenCalledWith(['/gallery'], {
      queryParams: { character_name: 'Saber' },
    });
  });
});
