import { useMemo } from "react";
import type { EChartsOption, LineSeriesOption } from "echarts";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { EChart } from "@/components/charts/EChart";
import { MONO, useChartTheme } from "@/components/charts/theme";
import { withAlpha } from "@/lib/colors";
import type { CompletedLap, LiveDriverRow, LiveSnapshot } from "../types";

/** Head-to-head cumulative-time gap between the compared pair, lap by lap,
 *  with two shaded bands covering both pit-strategy plays:
 *  - UNDERCUT (inner, green): the trailing car can jump ahead by pitting
 *    FIRST and beating the rival's own in/out laps on fresher tyres.
 *  - OVERCUT (outer, blue): the gap is too big for an undercut to work, but
 *    still close enough that staying out longer — gaining clean-air pace
 *    while the rival loses time in the pits — can flip the order instead.
 *  Both thresholds are broadcast rules-of-thumb (~half, then ~all, of a
 *  pit-stop loss), not measured values — the point is showing when each
 *  tactical window is live, not an exact number. Pit laps for either car
 *  are marked on their own trace. */

const UNDERCUT_WINDOW_SEC = 3.2;
const OVERCUT_WINDOW_SEC = 7;

function cumulativeByLap(log: readonly CompletedLap[]): Map<number, number> {
  let sum = 0;
  const map = new Map<number, number>();
  for (const l of log) {
    sum += l.timeSec;
    map.set(l.lap, sum);
  }
  return map;
}

export function UndercutWindow(props: {
  snapshot: LiveSnapshot;
  driverA: LiveDriverRow | null;
  driverB: LiveDriverRow | null;
  className?: string;
}) {
  const { snapshot, driverA, driverB } = props;
  const C = useChartTheme();
  const { t } = C;

  const option = useMemo<EChartsOption | null>(() => {
    if (!driverA || !driverB) return null;
    const logA = snapshot.lapLog.get(driverA.id) ?? [];
    const logB = snapshot.lapLog.get(driverB.id) ?? [];
    if (logA.length < 2 || logB.length < 2) return null;

    const cumA = cumulativeByLap(logA);
    const cumB = cumulativeByLap(logB);
    const laps = [...cumA.keys()].filter((l) => cumB.has(l)).sort((a, b) => a - b);
    if (laps.length < 2) return null;

    const points: [number, number][] = laps.map((lap) => [lap, (cumA.get(lap) as number) - (cumB.get(lap) as number)]);
    const maxAbs = Math.max(OVERCUT_WINDOW_SEC + 1, ...points.map((p) => Math.abs(p[1])));

    const pitMarker = (log: readonly CompletedLap[], color: string, label: string): LineSeriesOption => ({
      name: "__pit",
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: 0,
      showSymbol: false,
      lineStyle: { opacity: 0 },
      silent: true,
      tooltip: { show: false },
      data: [],
      markPoint: {
        symbol: "diamond",
        symbolSize: 9,
        itemStyle: { color, borderColor: t.surface, borderWidth: 1.5 },
        label: { show: false },
        data: log
          .filter((l) => l.isPitLap && cumA.has(l.lap) && cumB.has(l.lap))
          .map((l) => ({
            name: label,
            coord: [l.lap, (cumA.get(l.lap) as number) - (cumB.get(l.lap) as number)],
          })),
      },
    });

    const gapSeries: LineSeriesOption = {
      name: "GAP",
      type: "line",
      showSymbol: false,
      lineStyle: { width: 2.25, color: t.blue },
      areaStyle: undefined,
      data: points,
      markArea: {
        silent: true,
        label: { show: true, position: "insideTopLeft", fontFamily: MONO, fontSize: 9.5 },
        data: [
          [
            {
              yAxis: -UNDERCUT_WINDOW_SEC,
              itemStyle: { color: withAlpha(t.pos, 0.1) },
              label: { color: t.pos, formatter: "UNDERCUT WINDOW" },
            },
            { yAxis: UNDERCUT_WINDOW_SEC },
          ],
          [
            {
              yAxis: UNDERCUT_WINDOW_SEC,
              itemStyle: { color: withAlpha(t.blue, 0.08) },
              label: { color: t.blue, formatter: "OVERCUT WINDOW" },
            },
            { yAxis: OVERCUT_WINDOW_SEC },
          ],
          [{ yAxis: -OVERCUT_WINDOW_SEC, itemStyle: { color: withAlpha(t.blue, 0.08) } }, { yAxis: -UNDERCUT_WINDOW_SEC }],
        ],
      },
      markLine: {
        silent: true,
        symbol: "none",
        lineStyle: { color: t.inkMut, width: 1, type: "dashed" },
        label: { show: false },
        data: [{ yAxis: 0 }],
      },
    };

    return {
      animation: false,
      grid: { ...C.baseGrid, left: 44, right: 16, top: 14, bottom: 22 },
      tooltip: {
        ...C.baseTooltip,
        trigger: "axis",
        formatter: (params: unknown) => {
          const list = params as { axisValue: number; value: [number, number]; seriesName: string }[];
          const main = list.find((p) => p.seriesName === "GAP");
          if (!main) return "";
          const g = main.value[1];
          return C.tip(`LAP ${main.axisValue}`, [
            C.tipRow(`${driverA.code} − ${driverB.code}`, `${g >= 0 ? "+" : ""}${g.toFixed(2)}s`, {
              swatch: g < 0 ? driverA.color : driverB.color,
            }),
          ]);
        },
      },
      xAxis: C.valueAxis({ min: laps[0], max: laps[laps.length - 1], minInterval: 1, name: "LAP", nameLocation: "middle", nameGap: 20, nameTextStyle: { color: t.inkSub, fontFamily: MONO, fontSize: 10 } }),
      yAxis: C.valueAxis({
        min: -Math.ceil(maxAbs),
        max: Math.ceil(maxAbs),
        axisLabel: { ...C.axisLabel, formatter: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}s` },
      }),
      series: [gapSeries, pitMarker(logA, driverA.color, `${driverA.code} PIT`), pitMarker(logB, driverB.color, `${driverB.code} PIT`)],
    };
  }, [snapshot, driverA, driverB, C, t]);

  const ready = driverA != null && driverB != null;

  return (
    <AnalyticsCard
      eyebrow="Live · Strategy"
      title="Undercut / overcut window"
      subtitle={ready ? `${driverA.code} − ${driverB.code} cumulative gap · ♦ = pit stop · green = undercut, blue = overcut` : "select two cars"}
      empty={!option}
      emptyText="Needs at least two completed laps from both cars."
      expandable
      className={props.className}
      bodyClassName="p-2"
    >
      {option && <EChart option={option} />}
    </AnalyticsCard>
  );
}
