import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";

export type EChartEvents = Record<string, (params: any) => void>;

/** Dither-kit look: ordered-dither dot decal laid over every series fill
 *  (bars, areas, pies, heat cells). Semi-transparent black reads as a
 *  halftone on colored fills in both themes; lines/symbols are unaffected. */
const DITHER_ARIA: EChartsOption["aria"] = {
  enabled: true,
  label: { enabled: false },
  decal: {
    show: true,
    decals: [
      {
        symbol: "circle",
        symbolSize: 0.6,
        color: "rgba(0,0,0,0.28)",
        dashArrayX: [1, 0],
        dashArrayY: [2, 5],
        rotation: 0,
      },
      {
        symbol: "circle",
        symbolSize: 0.6,
        color: "rgba(0,0,0,0.28)",
        dashArrayX: [1, 0],
        dashArrayY: [4, 3],
        rotation: Math.PI / 6,
      },
    ],
  },
};

interface Props {
  option: EChartsOption;
  events?: EChartEvents;
  className?: string;
  /** re-created (dispose+init) when this changes — for structural swaps */
  chartKey?: string;
  /** Hands back the live ECharts instance once it's initialized (and again
   *  on re-init, e.g. after a chartKey change) — for callers that need to
   *  drive it imperatively (dispatchAction-based hover tracking, etc.)
   *  rather than only through the declarative `option`. */
  onChartReady?: (chart: echarts.ECharts | null) => void;
}

/** Owning wrapper for an ECharts instance: init once, ResizeObserver-driven
 *  resize (cards + fullscreen just work), notMerge option updates. */
export function EChart({ option, events, className, chartKey, onChartReady }: Props) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const eventsRef = useRef<EChartEvents | undefined>(events);
  eventsRef.current = events;
  const onReadyRef = useRef<Props["onChartReady"]>(onChartReady);
  onReadyRef.current = onChartReady;
  // live-updating widgets recompute `option` on every data tick; applying
  // that mid-hover resets the tooltip (and can flicker/dismiss it) right
  // as someone's trying to read it. Pausing while the pointer is over the
  // chart and flushing the latest option on leave keeps hover state alive
  // without holding stale data any longer than the hover itself lasts.
  const hoveringRef = useRef(false);
  const pendingOptionRef = useRef<EChartsOption | null>(null);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const chart = echarts.init(node, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    onReadyRef.current?.(chart);
    const proxyHandlers: [string, (p: any) => void][] = [];
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(node);
    // stable proxy handlers so option updates never rebind
    const bind = (name: string) => {
      const handler = (params: any) => eventsRef.current?.[name]?.(params);
      chart.on(name, handler);
      proxyHandlers.push([name, handler]);
    };
    for (const name of Object.keys(eventsRef.current ?? {})) bind(name);

    const onEnter = () => {
      hoveringRef.current = true;
    };
    const onLeave = () => {
      hoveringRef.current = false;
      if (pendingOptionRef.current) {
        chart.setOption({ aria: DITHER_ARIA, ...pendingOptionRef.current }, { notMerge: true });
        pendingOptionRef.current = null;
      }
    };
    node.addEventListener("mouseenter", onEnter);
    node.addEventListener("mouseleave", onLeave);

    return () => {
      observer.disconnect();
      node.removeEventListener("mouseenter", onEnter);
      node.removeEventListener("mouseleave", onLeave);
      for (const [name, handler] of proxyHandlers) chart.off(name, handler);
      chart.dispose();
      chartRef.current = null;
      hoveringRef.current = false;
      pendingOptionRef.current = null;
      onReadyRef.current?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartKey]);

  useEffect(() => {
    if (hoveringRef.current) {
      pendingOptionRef.current = option;
      return;
    }
    chartRef.current?.setOption({ aria: DITHER_ARIA, ...option }, { notMerge: true });
  }, [option, chartKey]);

  return <div ref={nodeRef} className={className ?? "h-full w-full"} />;
}
