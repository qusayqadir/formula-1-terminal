import { useEffect, useRef } from "react";
import type * as echarts from "echarts";

/** Reads one series' i-th data point as a [x, y] pixel-space-ready pair,
 *  regardless of whether the series was authored as raw [x,y] tuples
 *  (PositionsAroundPits, RaceReplayPage — value x-axis, one point per lap),
 *  {value:[x,y]} objects (same shape, just wrapped for a per-point symbol
 *  override), or a plain array of y-values addressed by index (
 *  QualifyingSegments — category x-axis, x is implicit). */
function dataPoint(raw: unknown, index: number): [number, number] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw as [number, number];
  if (typeof raw === "object" && "value" in (raw as Record<string, unknown>)) {
    const v = (raw as { value: unknown }).value;
    return Array.isArray(v) ? (v as [number, number]) : null;
  }
  if (typeof raw === "number") return [index, raw];
  return null;
}

interface PixelSeries {
  seriesIndex: number;
  points: ([number, number] | null)[]; // pixel-space, null where the source value was missing
}

/** Native ECharts `tooltip.trigger:"item"` only fires within a few px of an
 *  actual symbol — fine for densely-sampled data, but on charts with sparse
 *  points and long diagonal runs between them (3-segment qualifying times,
 *  or lap lines whose regular points are invisible — symbolSize:0, only
 *  pit-stop/DNF markers show), that means the connecting line itself is
 *  effectively unhoverable. This finds the nearest line to the cursor at
 *  its current pixel position (within `thresholdPx`) and drives the SAME
 *  per-series tooltip/emphasis via dispatchAction, so hovering anywhere
 *  along a line — not just its endpoints — surfaces its tooltip.
 *
 *  Pixel positions are cached (rebuilt on ECharts' "finished" event, not on
 *  every mousemove) so hover tracking is cheap distance math against a
 *  flat array, not a fresh coordinate transform per point per frame. */
export function useNearestLineHover(chart: echarts.ECharts | null, thresholdPx = 14) {
  const cacheRef = useRef<PixelSeries[]>([]);

  useEffect(() => {
    if (!chart) return;

    const buildCache = () => {
      const option = chart.getOption();
      const seriesList = (option.series as { data?: unknown[] }[]) ?? [];
      cacheRef.current = seriesList.map((s, seriesIndex) => ({
        seriesIndex,
        points: (s.data ?? []).map((raw, i) => {
          const dv = dataPoint(raw, i);
          if (!dv) return null;
          const px = chart.convertToPixel({ gridIndex: 0 }, dv);
          return px ? (px as [number, number]) : null;
        }),
      }));
    };

    let hoveredSeriesIndex: number | null = null;
    const clearHover = () => {
      if (hoveredSeriesIndex != null) {
        chart.dispatchAction({ type: "downplay", seriesIndex: hoveredSeriesIndex });
        chart.dispatchAction({ type: "hideTip" });
        hoveredSeriesIndex = null;
      }
    };

    const onMouseMove = (params: { offsetX: number; offsetY: number }) => {
      let best: { seriesIndex: number; dataIndex: number; dist: number } | null = null;

      for (const s of cacheRef.current) {
        for (let i = 0; i < s.points.length - 1; i++) {
          const a = s.points[i];
          const b = s.points[i + 1];
          if (!a || !b) continue;
          const minX = Math.min(a[0], b[0]);
          const maxX = Math.max(a[0], b[0]);
          if (params.offsetX < minX - 2 || params.offsetX > maxX + 2) continue;
          const t = b[0] === a[0] ? 0 : (params.offsetX - a[0]) / (b[0] - a[0]);
          const yAtX = a[1] + t * (b[1] - a[1]);
          const dist = Math.abs(yAtX - params.offsetY);
          if (dist <= thresholdPx && (!best || dist < best.dist)) {
            best = { seriesIndex: s.seriesIndex, dataIndex: t < 0.5 ? i : i + 1, dist };
          }
        }
      }

      if (best) {
        if (best.seriesIndex !== hoveredSeriesIndex) {
          clearHover();
          chart.dispatchAction({ type: "highlight", seriesIndex: best.seriesIndex });
          hoveredSeriesIndex = best.seriesIndex;
        }
        chart.dispatchAction({ type: "showTip", seriesIndex: best.seriesIndex, dataIndex: best.dataIndex });
      } else {
        clearHover();
      }
    };

    buildCache();
    chart.on("finished", buildCache);
    chart.getZr().on("mousemove", onMouseMove);
    chart.getZr().on("mouseout", clearHover);
    return () => {
      // The <EChart> wrapper can dispose this instance before our cleanup runs
      // (e.g. when a filter change empties the widget so it stops rendering the
      // chart). A disposed instance has no ZRender — getZr() returns null — so
      // guard every teardown call; otherwise `.off` on null throws and takes
      // the whole app down through the router error boundary.
      if (chart.isDisposed()) return;
      chart.off("finished", buildCache);
      const zr = chart.getZr();
      if (zr) {
        zr.off("mousemove", onMouseMove);
        zr.off("mouseout", clearHover);
      }
    };
  }, [chart, thresholdPx]);
}
