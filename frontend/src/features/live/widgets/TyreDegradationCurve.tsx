import { useMemo } from "react";
import type { EChartsOption, LineSeriesOption } from "echarts";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { EChart } from "@/components/charts/EChart";
import { useChartTheme } from "@/components/charts/theme";
import { teammateLineStyle } from "@/lib/colors";
import { formatLapTime } from "@/lib/format";
import { compareColor } from "../compareColors";
import { TYRE } from "../tyres";
import type { CompletedLap, LiveDriverRow, LiveSnapshot } from "../types";

/** Lap time vs. tyre age, one line per stint for the two compared cars —
 *  the actual degradation slope, not inferred from raw lap times. Out-laps
 *  and the in-lap (pit) are excluded since they carry warm-up / pit-loss
 *  time that has nothing to do with tyre wear. Stint index within a driver
 *  reuses `teammateLineStyle` (solid/dashed/dotted) — same convention as
 *  every other "second series, same identity colour" case on this page. */

interface StintPoint {
  age: number;
  timeSec: number;
  lap: number;
}

function stintSeries(row: LiveDriverRow, log: readonly CompletedLap[]): StintPoint[][] {
  return row.stints.map((stint) => {
    const end = stint.endLap ?? row.lapNumber;
    return log
      .filter((l) => l.lap >= stint.startLap && l.lap <= end && !l.isOutLap && !l.isPitLap)
      .map((l) => ({ age: l.tyreAgeAtLap, timeSec: l.timeSec, lap: l.lap }))
      .sort((a, b) => a.age - b.age);
  });
}

export function TyreDegradationCurve(props: {
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
    const stintsA = stintSeries(driverA, logA);
    const stintsB = stintSeries(driverB, logB);
    const hasData = [...stintsA, ...stintsB].some((s) => s.length >= 2);
    if (!hasData) return null;

    const allTimes = [...stintsA, ...stintsB].flatMap((s) => s.map((p) => p.timeSec));
    const minTime = Math.min(...allTimes);
    const maxTime = Math.max(...allTimes);
    // tight zoom by design: the whole point of this chart is making a
    // sub-second-per-lap degradation slope visible, so a generous auto-range
    // (or the default 0-based axis) flattens it into a straight line
    const pad = Math.max(0.12, (maxTime - minTime) * 0.08);

    const series: LineSeriesOption[] = [];
    [
      { row: driverA, stints: stintsA, slot: "a" as const },
      { row: driverB, stints: stintsB, slot: "b" as const },
    ].forEach(({ row, stints, slot }) => {
      const lineColor = compareColor(slot, driverA, driverB);
      stints.forEach((points, i) => {
        if (points.length < 2) return;
        const stint = row.stints[i];
        const stintStart = points[0].timeSec;
        series.push({
          name: `${row.code} · stint ${i + 1} (${stint.compound})`,
          type: "line",
          symbol: "circle",
          symbolSize: 5,
          lineStyle: { width: 1.75, type: teammateLineStyle(i), color: lineColor },
          itemStyle: { color: TYRE[stint.compound].color, borderColor: lineColor, borderWidth: 1.5 },
          data: points.map((p) => ({
            value: [p.age, p.timeSec],
            lap: p.lap,
            deltaToStintStart: p.timeSec - stintStart,
          })),
        });
      });
    });

    return {
      animation: false,
      grid: { ...C.baseGrid, left: 52, right: 20, top: 14, bottom: 32 },
      tooltip: {
        ...C.baseTooltip,
        // item-trigger on a 5px symbol is nearly impossible to hit — axis
        // trigger fires anywhere along the vertical at that tyre age, and
        // shows every stint present there in one card
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.inkSub, width: 1, type: "dashed" } },
        formatter: (params: unknown) => {
          const list = params as {
            seriesName: string;
            axisValue: number;
            value: [number, number];
            color: string;
            data: { lap: number; deltaToStintStart: number };
          }[];
          if (!list.length) return "";
          // axis-trigger reports EVERY series, snapping each to its nearest
          // point — but stints span different tyre-age ranges, so a stint
          // with no lap at this age would otherwise show a stale edge point
          // under a header age that doesn't even match it. Keep only the
          // stints that actually have a lap at the hovered age. Round rather
          // than test exact equality — on a value axis axisPointer may report
          // a fractional cursor position, and tyre ages are whole laps.
          const age = Math.round(Number(list[0].axisValue));
          const atAge = list.filter((p) => Math.round(p.value[0]) === age);
          if (!atAge.length) return "";
          return C.tip(
            `TYRE AGE ${age} lap${age === 1 ? "" : "s"}`,
            atAge.map((p) => {
              const [code, stintLabel] = p.seriesName.split(" · ");
              const delta = p.data.deltaToStintStart;
              const deltaText =
                Math.abs(delta) < 0.0005 ? "±0.000s" : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(3)}s`;
              return C.tipRow(`${code} ${stintLabel} · L${p.data.lap}`, `${formatLapTime(p.value[1])} (${deltaText})`, {
                swatch: p.color,
              });
            }),
          );
        },
      },
      xAxis: C.valueAxis({
        name: "TYRE AGE · LAPS",
        nameLocation: "middle",
        nameGap: 22,
        nameTextStyle: { color: t.inkSub, fontFamily: "JetBrains Mono Variable, monospace", fontSize: 10 },
        minInterval: 1,
      }),
      yAxis: C.valueAxis({
        min: Math.floor((minTime - pad) * 10) / 10,
        max: Math.ceil((maxTime + pad) * 10) / 10,
        name: "LAP TIME · S",
        nameTextStyle: { color: t.inkSub, fontFamily: "JetBrains Mono Variable, monospace", fontSize: 10, align: "left" },
        nameGap: 14,
      }),
      series,
    };
  }, [snapshot.lapLog, driverA, driverB, C, t]);

  const ready = driverA != null && driverB != null;

  return (
    <AnalyticsCard
      eyebrow="Live · Strategy"
      title="Tyre degradation"
      subtitle={ready ? `${driverA.code} vs ${driverB.code} · lap time vs tyre age, out/in-laps excluded` : "select two cars"}
      empty={!option}
      emptyText="Needs at least one full stint (2+ green-flag laps) from both cars."
      expandable
      className={props.className}
      bodyClassName="p-2"
    >
      {option && <EChart option={option} />}
    </AnalyticsCard>
  );
}
