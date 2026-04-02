import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { init, type ECharts, type EChartsCoreOption, use } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

use([BarChart, LineChart, GridComponent, LegendComponent, SVGRenderer, TooltipComponent]);

@Component({
  selector: 'zukan-echart-panel',
  template: '<div #host class="chart-host"></div>',
  styles: [`
    :host {
      display: block;
      min-height: 260px;
    }

    .chart-host {
      width: 100%;
      height: 100%;
      min-height: 260px;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EchartPanelComponent implements AfterViewInit {
  readonly option = input.required<EChartsCoreOption>();
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  private chart: ECharts | null = null;
  private resizeObserver?: ResizeObserver;

  constructor() {
    effect(() => {
      const option = this.option();
      if (this.chart) {
        this.chart.setOption(option, true);
      }
    });
  }

  ngAfterViewInit(): void {
    const element = this.host().nativeElement;
    const width = element.clientWidth || 640;
    const height = element.clientHeight || 280;
    this.chart = init(element, undefined, { renderer: 'svg', width, height });
    this.chart.setOption(this.option(), true);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
      this.resizeObserver.observe(element);
    }
    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.chart?.dispose();
      this.chart = null;
    });
  }
}
