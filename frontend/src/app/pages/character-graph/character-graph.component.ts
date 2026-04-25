import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import Sigma from 'sigma';
import { catchError, debounceTime, distinctUntilChanged, forkJoin, of, switchMap } from 'rxjs';
import {
  CharacterGraphNode,
  CharacterGraphResponse,
  CharacterGraphSearchResult,
  GraphSeriesMode,
} from '../../models/character-graph';
import { LayoutComponent } from '../../components/layout/layout/layout.component';
import { CharacterGraphClientService } from '../../services/web/character-graph-client.service';
import { MediaService } from '../../services/media.service';
import { formatMetadataName } from '../../utils/media-display.utils';

interface GraphNodeAttributes {
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  zIndex?: number;
}

interface GraphEdgeAttributes {
  size: number;
  color: string;
  similarity: number;
}

interface ThumbnailPreview {
  id: string;
  url: string | null;
}

interface GraphPalette {
  node: string;
  nodeSeries: string;
  selected: string;
  neighbor: string;
  dimmedNode: string;
  edge: string;
  selectedEdge: string;
  dimmedEdge: string;
  label: string;
  hoverBackground: string;
  hoverShadow: string;
}

@Component({
  selector: 'zukan-character-graph',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    LayoutComponent,
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  templateUrl: './character-graph.component.html',
  styleUrl: './character-graph.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CharacterGraphPageComponent implements AfterViewInit, OnDestroy {
  private readonly client = inject(CharacterGraphClientService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mediaService = inject(MediaService);
  private readonly router = inject(Router);
  private readonly container = viewChild<ElementRef<HTMLDivElement>>('graphContainer');

  private graph: Graph<GraphNodeAttributes, GraphEdgeAttributes> | null = null;
  private renderer: Sigma<GraphNodeAttributes, GraphEdgeAttributes> | null = null;
  private fallbackRender: (() => void) | null = null;
  private themeObserver: MutationObserver | null = null;
  private viewReady = false;

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly minSimilarityControl = new FormControl(0.7, { nonNullable: true });
  readonly seriesModeControl = new FormControl<GraphSeriesMode>('any', { nonNullable: true });

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly sourceGraphData = signal<CharacterGraphResponse | null>(null);
  readonly graphData = signal<CharacterGraphResponse | null>(null);
  readonly selectedNodeId = signal<string | null>(null);
  readonly centeredGraphNodeId = signal<string | null>(null);
  readonly suggestions = signal<CharacterGraphSearchResult[]>([]);
  readonly thumbnails = signal<ThumbnailPreview[]>([]);

  readonly selectedNode = computed(() => {
    const id = this.selectedNodeId();
    return this.graphData()?.nodes.find((node) => node.id === id) ?? null;
  });

  readonly selectedNeighbors = computed(() => {
    const id = this.selectedNodeId();
    const data = this.graphData();
    if (!id || !data) {
      return [];
    }
    const neighborIds = new Set(
      data.edges
        .filter((edge) => edge.source === id || edge.target === id)
        .map((edge) => edge.source === id ? edge.target : edge.source),
    );
    return data.nodes.filter((node) => neighborIds.has(node.id));
  });

  constructor() {
    this.searchControl.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef),
      debounceTime(160),
      distinctUntilChanged(),
      switchMap((value) => {
        const query = value.trim();
        return query
          ? this.client.searchCharacters(query, 12).pipe(catchError(() => of([])))
          : of([]);
      }),
    ).subscribe((suggestions) => this.suggestions.set(suggestions));

    this.minSimilarityControl.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef),
      distinctUntilChanged(),
    ).subscribe(() => this.applyClientGraphState());

    this.seriesModeControl.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef),
      distinctUntilChanged(),
    ).subscribe(() => this.applyClientGraphState());

    effect(() => {
      const node = this.selectedNode();
      this.renderer?.refresh();
      this.fallbackRender?.();
      this.loadThumbnails(node);
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.themeObserver = new MutationObserver(() => this.refreshGraphColors());
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    this.loadGraph();
  }

  ngOnDestroy(): void {
    this.renderer?.kill();
    this.renderer = null;
    this.fallbackRender = null;
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.graph = null;
  }

  formatName(name: string): string {
    return formatMetadataName(name);
  }

  onSuggestionSelected(event: MatAutocompleteSelectedEvent): void {
    const character = event.option.value as CharacterGraphSearchResult;
    this.searchControl.setValue(this.formatName(character.name), { emitEvent: false });
    this.suggestions.set([]);
    if (this.sourceGraphData()?.nodes.some((node) => node.id === character.id)) {
      this.centeredGraphNodeId.set(null);
      this.selectedNodeId.set(character.id);
      this.applyClientGraphState();
      return;
    }
    this.loadGraph(character.id);
  }

  centerOnSelected(): void {
    const node = this.selectedNode();
    if (!node) {
      return;
    }
    this.centeredGraphNodeId.set(node.id);
    this.applyClientGraphState();
  }

  showFullGraph(): void {
    this.centeredGraphNodeId.set(null);
    this.applyClientGraphState();
  }

  openMediaSearch(): void {
    const node = this.selectedNode();
    if (!node) {
      return;
    }
    void this.router.navigate(['/gallery'], {
      queryParams: { character_name: node.name },
    });
  }

  clearSelection(): void {
    this.selectedNodeId.set(null);
    this.renderer?.refresh();
  }

  private loadGraph(centerEntityId?: string): void {
    this.loading.set(true);
    this.error.set(null);
    const selectedBeforeLoad = centerEntityId ?? this.selectedNodeId();
    this.client.getCharacterGraph({
      center_entity_id: centerEntityId,
      limit: 80,
      min_similarity: 0,
      series_mode: 'any',
      sample_size: 6,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.sourceGraphData.set(data);
        this.centeredGraphNodeId.set(centerEntityId ?? null);
        const nextSelection = centerEntityId
          ?? (selectedBeforeLoad && data.nodes.some((node) => node.id === selectedBeforeLoad) ? selectedBeforeLoad : null)
          ?? data.center_entity_id;
        this.selectedNodeId.set(nextSelection);
        this.applyClientGraphState();
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.detail ?? 'Unable to load the character graph.');
      },
    });
  }

  private applyClientGraphState(): void {
    const source = this.sourceGraphData();
    if (!source) {
      this.graphData.set(null);
      return;
    }

    const minSimilarity = this.minSimilarityControl.value;
    const seriesMode = this.seriesModeControl.value;
    const matchingEdges = source.edges.filter((edge) =>
      edge.similarity >= minSimilarity && this.edgeMatchesSeriesMode(edge, seriesMode),
    );
    const centeredNodeId = this.centeredGraphNodeId();
    const nodeIds = centeredNodeId
      ? this.centeredNodeIds(centeredNodeId, matchingEdges)
      : new Set(source.nodes.map((node) => node.id));
    const edges = matchingEdges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    const nodes = source.nodes.filter((node) => nodeIds.has(node.id));
    const nextGraph = {
      ...source,
      nodes,
      edges,
    };
    this.graphData.set(nextGraph);

    const selected = this.selectedNodeId();
    if (selected && !nodes.some((node) => node.id === selected)) {
      this.selectedNodeId.set(centeredNodeId && nodes.some((node) => node.id === centeredNodeId) ? centeredNodeId : null);
    }

    if (this.viewReady) {
      this.renderGraph(nextGraph);
    }
  }

  private centeredNodeIds(centeredNodeId: string, edges: CharacterGraphResponse['edges']): Set<string> {
    const source = this.sourceGraphData();
    if (!source?.nodes.some((node) => node.id === centeredNodeId)) {
      return new Set(source?.nodes.map((node) => node.id) ?? []);
    }
    const neighbors = edges
      .filter((edge) => edge.source === centeredNodeId || edge.target === centeredNodeId)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 79)
      .map((edge) => edge.source === centeredNodeId ? edge.target : edge.source);
    return new Set([centeredNodeId, ...neighbors]);
  }

  private edgeMatchesSeriesMode(edge: CharacterGraphResponse['edges'][number], seriesMode: GraphSeriesMode): boolean {
    if (seriesMode === 'same') {
      return edge.shared_series.length > 0;
    }
    if (seriesMode === 'different') {
      return edge.shared_series.length === 0;
    }
    return true;
  }

  private renderGraph(data: CharacterGraphResponse): void {
    const element = this.container()?.nativeElement;
    if (!element) {
      return;
    }

    this.renderer?.kill();
    this.renderer = null;
    this.fallbackRender = null;
    element.replaceChildren();
    const graph = new Graph<GraphNodeAttributes, GraphEdgeAttributes>();
    const palette = this.graphPalette();
    const radius = Math.max(1, data.nodes.length / 8);
    data.nodes.forEach((node, index) => {
      const angle = (index / Math.max(1, data.nodes.length)) * Math.PI * 2;
      graph.addNode(node.id, {
        label: this.formatName(node.name),
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        size: this.nodeSize(node),
        color: this.nodeColor(node, palette),
      });
    });

    data.edges.forEach((edge) => {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
        return;
      }
      graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
        size: Math.max(0.28, edge.similarity * 1.15),
        color: palette.edge,
        similarity: edge.similarity,
      });
    });

    if (graph.order > 1) {
      forceAtlas2.assign(graph, {
        iterations: graph.order > 120 ? 32 : 56,
        settings: forceAtlas2.inferSettings(graph),
      });
      this.normalizeGraphLayout(graph);
    }

    this.graph = graph;
    try {
      this.renderer = new Sigma(graph, element, {
        allowInvalidContainer: true,
        autoCenter: true,
        autoRescale: true,
        cameraPanBoundaries: { tolerance: 140 },
        draggedEventsTolerance: 6,
        enableCameraPanning: true,
        enableCameraRotation: false,
        renderEdgeLabels: false,
        stagePadding: 64,
        zIndex: true,
        labelColor: { color: palette.label },
        defaultNodeColor: palette.node,
        defaultEdgeColor: palette.edge,
        defaultDrawNodeHover: (context, data, settings) => this.drawNodeHover(context, data, settings),
        labelDensity: 0.08,
        labelRenderedSizeThreshold: 7,
        labelSize: 11,
        labelWeight: '500',
        nodeReducer: (node, attrs) => this.reduceNode(node, attrs),
        edgeReducer: (edge, attrs) => this.reduceEdge(edge, attrs),
      });
      this.renderer.on('clickNode', ({ node }) => {
        this.selectedNodeId.set(node);
      });
      this.renderer.on('clickStage', () => this.clearSelection());
    } catch {
      this.drawFallbackGraph(element, graph);
    }
  }

  private reduceNode(node: string, attrs: GraphNodeAttributes): GraphNodeAttributes {
    const selected = this.selectedNodeId();
    const palette = this.graphPalette();
    if (!selected || !this.graph) {
      return attrs;
    }
    if (node === selected) {
      return { ...attrs, color: palette.selected, size: attrs.size + 1.5, zIndex: 3 };
    }
    if (this.graph.areNeighbors(node, selected)) {
      return { ...attrs, color: palette.neighbor, size: attrs.size + 0.65, zIndex: 2 };
    }
    return { ...attrs, color: palette.dimmedNode, label: '', zIndex: 0 };
  }

  private reduceEdge(edge: string, attrs: GraphEdgeAttributes): GraphEdgeAttributes {
    const selected = this.selectedNodeId();
    const palette = this.graphPalette();
    if (!selected || !this.graph) {
      return attrs;
    }
    const [source, target] = this.graph.extremities(edge);
    if (source === selected || target === selected) {
      return { ...attrs, color: palette.selectedEdge, size: attrs.size + 0.5 };
    }
    return { ...attrs, color: palette.dimmedEdge, size: 0.18 };
  }

  private drawNodeHover(
    context: CanvasRenderingContext2D,
    data: { x: number; y: number; size: number; label?: unknown; color: string },
    settings: { labelSize: number; labelFont: string; labelWeight: string },
  ): void {
    const palette = this.graphPalette();
    const label = typeof data.label === 'string' ? data.label : '';
    const labelSize = settings.labelSize;
    const padding = 4;
    const nodePadding = 2.5;

    context.font = `${settings.labelWeight} ${labelSize}px ${settings.labelFont}`;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 1;
    context.shadowBlur = 10;
    context.shadowColor = palette.hoverShadow;
    context.fillStyle = palette.hoverBackground;

    if (label) {
      const textWidth = context.measureText(label).width;
      const boxHeight = Math.round(labelSize + padding * 2);
      const boxWidth = Math.round(textWidth + padding * 3);
      const radius = Math.max(data.size + nodePadding, labelSize / 2 + padding);
      const angle = Math.asin(boxHeight / 2 / radius);
      const xDelta = Math.sqrt(Math.max(0, radius ** 2 - (boxHeight / 2) ** 2));

      context.beginPath();
      context.moveTo(data.x + xDelta, data.y + boxHeight / 2);
      context.lineTo(data.x + radius + boxWidth, data.y + boxHeight / 2);
      context.lineTo(data.x + radius + boxWidth, data.y - boxHeight / 2);
      context.lineTo(data.x + xDelta, data.y - boxHeight / 2);
      context.arc(data.x, data.y, radius, angle, -angle);
      context.closePath();
      context.fill();
    } else {
      context.beginPath();
      context.arc(data.x, data.y, data.size + nodePadding, 0, Math.PI * 2);
      context.closePath();
      context.fill();
    }

    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.fillStyle = data.color;
    context.beginPath();
    context.arc(data.x, data.y, data.size, 0, Math.PI * 2);
    context.fill();

    if (label) {
      context.fillStyle = palette.label;
      context.fillText(label, data.x + data.size + padding + 4, data.y + labelSize / 3);
    }
  }

  private normalizeGraphLayout(graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>): void {
    const nodes = graph.nodes();
    if (nodes.length === 0) {
      return;
    }
    const positions = nodes.map((node) => graph.getNodeAttributes(node));
    const minX = Math.min(...positions.map((attrs) => attrs.x));
    const maxX = Math.max(...positions.map((attrs) => attrs.x));
    const minY = Math.min(...positions.map((attrs) => attrs.y));
    const maxY = Math.max(...positions.map((attrs) => attrs.y));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY, 0.1);
    graph.forEachNode((node, attrs) => {
      graph.setNodeAttribute(node, 'x', (attrs.x - centerX) / span);
      graph.setNodeAttribute(node, 'y', (attrs.y - centerY) / span);
    });
  }

  private drawFallbackGraph(
    element: HTMLDivElement,
    graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>,
  ): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'graph-fallback-canvas';
    element.replaceChildren(canvas);
    const render = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width || 640));
      const height = Math.max(320, Math.floor(rect.height || 620));
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const project = this.fallbackProjector(graph, width, height);

      graph.forEachEdge((edge, attrs, source, target) => {
        const sourcePoint = project(source);
        const targetPoint = project(target);
        const reduced = this.reduceEdge(edge, attrs);
        ctx.strokeStyle = reduced.color;
        ctx.lineWidth = reduced.size;
        ctx.beginPath();
        ctx.moveTo(sourcePoint.x, sourcePoint.y);
        ctx.lineTo(targetPoint.x, targetPoint.y);
        ctx.stroke();
      });

      graph.forEachNode((node, attrs) => {
        const point = project(node);
        const reduced = this.reduceNode(node, attrs);
        ctx.fillStyle = reduced.color;
        ctx.beginPath();
        ctx.arc(point.x, point.y, reduced.size, 0, Math.PI * 2);
        ctx.fill();
        if (reduced.label) {
          ctx.fillStyle = this.graphPalette().label;
          ctx.font = '500 11px Roboto, Arial, sans-serif';
          ctx.fillText(reduced.label, point.x + reduced.size + 6, point.y + 4);
        }
      });
    };

    canvas.addEventListener('click', (event) => {
      const rect = canvas.getBoundingClientRect();
      const project = this.fallbackProjector(graph, rect.width, rect.height);
      let nearestNode: string | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      graph.forEachNode((node, attrs) => {
        const point = project(node);
        const distance = Math.hypot(event.clientX - rect.left - point.x, event.clientY - rect.top - point.y);
        if (distance <= attrs.size + 10 && distance < nearestDistance) {
          nearestNode = node;
          nearestDistance = distance;
        }
      });
      if (nearestNode) {
        this.selectedNodeId.set(nearestNode);
      } else {
        this.clearSelection();
      }
    });
    this.fallbackRender = render;
    render();
  }

  private fallbackProjector(
    graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>,
    width: number,
    height: number,
  ): (node: string) => { x: number; y: number } {
    const positions = graph.nodes().map((node) => graph.getNodeAttributes(node));
    const minX = Math.min(...positions.map((attrs) => attrs.x), -1);
    const maxX = Math.max(...positions.map((attrs) => attrs.x), 1);
    const minY = Math.min(...positions.map((attrs) => attrs.y), -1);
    const maxY = Math.max(...positions.map((attrs) => attrs.y), 1);
    const spanX = Math.max(0.1, maxX - minX);
    const spanY = Math.max(0.1, maxY - minY);
    const padding = 56;
    return (node: string) => {
      const attrs = graph.getNodeAttributes(node);
      return {
        x: padding + ((attrs.x - minX) / spanX) * Math.max(1, width - padding * 2),
        y: padding + ((attrs.y - minY) / spanY) * Math.max(1, height - padding * 2),
      };
    };
  }

  private loadThumbnails(node: CharacterGraphNode | null): void {
    if (!node || node.representative_media_ids.length === 0) {
      this.thumbnails.set([]);
      return;
    }
    forkJoin(
      node.representative_media_ids.map((id) => this.mediaService.getThumbnailUrl(id).pipe(
        catchError(() => of(null)),
        switchMap((url) => of({ id, url })),
      )),
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((items) => this.thumbnails.set(items));
  }

  private nodeSize(node: CharacterGraphNode): number {
    return Math.max(3, Math.min(9, 3 + Math.sqrt(node.embedding_support) * 1.05));
  }

  private nodeColor(node: CharacterGraphNode, palette = this.graphPalette()): string {
    if (node.series_names.length > 0) {
      return palette.nodeSeries;
    }
    return palette.node;
  }

  private refreshGraphColors(): void {
    const data = this.graphData();
    if (!data || !this.graph) {
      return;
    }
    const palette = this.graphPalette();
    data.nodes.forEach((node) => {
      if (this.graph?.hasNode(node.id)) {
        this.graph.setNodeAttribute(node.id, 'color', this.nodeColor(node, palette));
      }
    });
    this.graph.forEachEdge((edge) => {
      this.graph?.setEdgeAttribute(edge, 'color', palette.edge);
    });
    this.renderer?.setSettings({
      labelColor: { color: palette.label },
      defaultNodeColor: palette.node,
      defaultEdgeColor: palette.edge,
      defaultDrawNodeHover: (context, data, settings) => this.drawNodeHover(context, data, settings),
      labelSize: 11,
      labelWeight: '500',
    });
    this.renderer?.refresh();
    this.fallbackRender?.();
  }

  private graphPalette(): GraphPalette {
    const element = this.container()?.nativeElement ?? document.documentElement;
    const styles = getComputedStyle(element);
    const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    return {
      node: read('--character-graph-node', '#607d8b'),
      nodeSeries: read('--character-graph-node-series', '#3f51b5'),
      selected: read('--character-graph-node-selected', '#6750a4'),
      neighbor: read('--character-graph-node-neighbor', '#00897b'),
      dimmedNode: read('--character-graph-node-dimmed', '#b0bec5'),
      edge: read('--character-graph-edge', 'rgba(38, 50, 56, 0.58)'),
      selectedEdge: read('--character-graph-edge-selected', 'rgba(81, 45, 168, 0.78)'),
      dimmedEdge: read('--character-graph-edge-dimmed', 'rgba(38, 50, 56, 0.36)'),
      label: read('--character-graph-label', 'rgba(28, 27, 31, 0.88)'),
      hoverBackground: read('--character-graph-hover-background', 'rgba(255, 255, 255, 0.95)'),
      hoverShadow: read('--character-graph-hover-shadow', 'rgba(28, 27, 31, 0.22)'),
    };
  }
}
