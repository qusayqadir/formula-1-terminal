import { useMemo } from "react";
import type { EChartsOption, SeriesOption } from "echarts";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { GlassSelect } from "@/components/ui/controls";
import { EChart } from "@/components/charts/EChart";
import { MONO, useChartTheme } from "@/components/charts/theme";
import { withAlpha } from "@/lib/colors";
import { SECTOR_SPLITS, TRACK_LENGTH_M } from "../circuit";
import { compareColor } from "../compareColors";
import { telemetryLap } from "../telemetry";
import type { LiveDriverRow, LiveSnapshot } from "../types";

/** Telemetry trace for the two compared cars, laid out as FOUR roomy graphs
 *  stacked on top of one another over lap distance: speed, RPM, throttle+brake
 *  (pedals share one graph — throttle as a line, brake as a filled wash), and
 *  gear. Car A is always solid, car B always dashed — that also keeps
 *  team-mates (same team hue) tellable apart. Speed carries the S1/S2/S3 zone
 *  labels; every graph is crossed by dashed sector-boundary verticals and
 *  shares a single linked cursor. Each graph gets real vertical height and a
 *  clear gap to its neighbours so two drivers' traces read at a glance instead
 *  of being squeezed together. Traces are each car's most recent completed
 *  lap. (DRS intentionally omitted.) */

type ChannelKey = "speedKph" | "rpm" | "throttlePct" | "brakePct" | "gear";

interface Grid {
  id: string;
  /** y-axis title */
  label: string;
  /** channels drawn in this graph — pedals stacks throttle + brake */
  keys: ChannelKey[];
  /** fixed axis bounds — omitted for graphs that instead zoom to the actual
   *  data range (see `dynamicRange` below) */
  min?: number;
  max?: number;
  /** minimum padding added on each side of a dynamic data range, in the
   *  channel's own units — keeps a near-flat trace from zooming in so far it
   *  looks like noise */
  minPad?: number;
  splitNumber: number;
  height: number; // percent
  top: number; // percent
  step?: "end";
}

/** rounding step (in the channel's own units) applied to a computed dynamic
 *  min/max — keeps the axis boundary aligned with ECharts' own tick spacing so
 *  it never renders as a stray, cramped extra label on top of the regular
 *  ticks (e.g. "13,791" jammed above a "13,000" tick) */
const NICE_STEP: Partial<Record<ChannelKey, number>> = {
  speedKph: 10,
  rpm: 250,
};

// four generously-spaced graphs; speed gets the most height, gear the least
const GRIDS: Grid[] = [
  { id: "speed", label: "SPEED · KPH", keys: ["speedKph"], minPad: 8, splitNumber: 6, height: 21, top: 6 },
  { id: "rpm", label: "RPM", keys: ["rpm"], minPad: 300, splitNumber: 4, height: 19, top: 33 },
  {
    id: "pedals",
    label: "THROTTLE / BRAKE · %",
    keys: ["throttlePct", "brakePct"],
    min: 0,
    max: 100,
    splitNumber: 4,
    height: 19,
    top: 58,
  },
  { id: "gear", label: "GEAR", keys: ["gear"], min: 1, max: 8, splitNumber: 2, height: 12, top: 83, step: "end" },
];

const CHANNEL_UNIT: Record<ChannelKey, string> = {
  speedKph: " kph",
  rpm: " rpm",
  throttlePct: " %",
  brakePct: " %",
  gear: "",
};

const CHANNEL_TAG: Partial<Record<ChannelKey, string>> = {
  throttlePct: "THR",
  brakePct: "BRK",
};

const S1_END = SECTOR_SPLITS[0] * TRACK_LENGTH_M;
const S2_END = SECTOR_SPLITS[1] * TRACK_LENGTH_M;

interface PickerOption {
  value: number;
  label: string;
  hint: string;
}

export function TelemetryCompare(props: {
  snapshot: LiveSnapshot;
  driverA: LiveDriverRow | null;
  driverB: LiveDriverRow | null;
  className?: string;
  /** local Car A/B pickers in the card header — same picks as the page
   *  header, just close enough to the chart that you don't scroll for it */
  picker?: {
    aValue: number;
    bValue: number;
    optionsA: PickerOption[];
    optionsB: PickerOption[];
    onPickA: (id: number) => void;
    onPickB: (id: number) => void;
  };
}) {
  const { snapshot, driverA, driverB } = props;
  const C = useChartTheme();
  const { t } = C;

  const sessionBestSec = snapshot.sessionBestLap?.sec ?? null;

  const option = useMemo<EChartsOption | null>(() => {
    // Car A is the always-on trace; Car B is optional — the widget shows a
    // single car until a comparison car is explicitly picked.
    if (!driverA?.lastLap) return null;

    const carDefs: { row: LiveDriverRow; dash: "solid" | "dashed"; slot: "a" | "b" }[] = [
      { row: driverA, dash: "solid", slot: "a" },
    ];
    if (driverB?.lastLap) carDefs.push({ row: driverB, dash: "dashed", slot: "b" });

    const cars = carDefs.map(({ row, dash, slot }) => ({
      row,
      dash,
      // A keeps its own identity colour; when B is a team-mate it shares the
      // exact same hue, so compareColor lightens it so the two overlaid
      // traces don't render as one line
      color: slot === "a" ? driverA.color : compareColor("b", driverA, driverB!),
      // pace handicap for the synth profile: distance off the session-best lap
      samples: telemetryLap(
        row.id,
        row.lastLap!.lap,
        sessionBestSec != null && row.bestLapSec != null ? Math.max(0, row.bestLapSec - sessionBestSec) : 0.4,
      ),
    }));

    // zoom speed + RPM to the actual range covered by these two cars' laps — a
    // fixed 40-350 kph axis makes two drivers within a few kph of each other
    // look identical; zooming to what they actually did makes that gap the
    // dominant visual feature instead of a flat line near the top
    const dynamicRange = new Map<string, { min: number; max: number }>();
    for (const g of GRIDS) {
      if (g.min != null) continue;
      const values = cars.flatMap(({ samples }) =>
        samples.flatMap((s) => g.keys.map((k) => s[k] as number)),
      );
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      const pad = Math.max(g.minPad ?? 0, (hi - lo) * 0.12);
      const step = NICE_STEP[g.keys[0]] ?? 1;
      const min = Math.floor((lo - pad) / step) * step;
      const max = Math.ceil((hi + pad) / step) * step;
      dynamicRange.set(g.id, { min, max });
    }

    const sectorLines = {
      silent: true,
      symbol: "none" as const,
      animation: false,
      lineStyle: { color: t.inkMut, width: 1, type: "dashed" as const, opacity: 0.55 },
      label: { show: false },
      data: [{ xAxis: S1_END }, { xAxis: S2_END }],
    };

    const series: SeriesOption[] = [];
    // parallel table so the axis tooltip can label each mark (car + channel)
    // without baking the channel into the series name (which would split the
    // two-entry legend into throttle/brake rows)
    const seriesMeta: { gi: number; carCode: string; key: ChannelKey }[] = [];

    GRIDS.forEach((g, gi) => {
      let firstOfGrid = true;
      g.keys.forEach((key) => {
        cars.forEach(({ row, dash, samples, color }, ci) => {
          const isBrake = key === "brakePct";
          const data = samples.map((s) => [s.dist, s[key]]);
          series.push({
            name: row.code,
            type: "line",
            xAxisIndex: gi,
            yAxisIndex: gi,
            showSymbol: false,
            step: g.step,
            // brake reads as a filled wash under the throttle line so the two
            // pedal channels are tellable apart inside the shared graph
            lineStyle: {
              width: isBrake ? 0 : key === "speedKph" ? 2.5 : 1.75,
              type: dash,
              color,
            },
            areaStyle: isBrake ? { color: withAlpha(color, ci === 0 ? 0.22 : 0.14), opacity: 1 } : undefined,
            itemStyle: { color },
            emphasis: { disabled: true },
            data,
            // dashed sector boundaries on every graph (one series carries them);
            // zone labels only on speed
            markLine: firstOfGrid ? sectorLines : undefined,
            markArea:
              gi === 0 && firstOfGrid
                ? {
                    silent: true,
                    animation: false,
                    label: {
                      show: true,
                      position: "insideTop",
                      color: t.inkSub,
                      fontSize: 10,
                      fontFamily: MONO,
                      distance: 4,
                    },
                    data: [
                      [{ name: "S1", xAxis: 0, itemStyle: { color: "transparent" } }, { xAxis: S1_END }],
                      [
                        { name: "S2", xAxis: S1_END, itemStyle: { color: withAlpha(t.ink, 0.03) } },
                        { xAxis: S2_END },
                      ],
                      [{ name: "S3", xAxis: S2_END, itemStyle: { color: "transparent" } }, { xAxis: TRACK_LENGTH_M }],
                    ],
                  }
                : undefined,
          });
          seriesMeta.push({ gi, carCode: row.code, key });
          firstOfGrid = false;
        });
      });
    });

    return {
      animation: false,
      // legend rides the top-right corner — the bottom edge belongs to the
      // last graph's distance labels
      legend: {
        ...C.legendStyle,
        bottom: undefined,
        left: undefined,
        top: 0,
        right: 8,
        data: cars.map((c) => c.row.code),
      },
      axisPointer: { link: [{ xAxisIndex: "all" }], lineStyle: { color: t.inkSub, width: 1 } },
      tooltip: {
        ...C.baseTooltip,
        trigger: "axis",
        formatter: (params: unknown) => {
          const all = params as {
            axisValue: number;
            axisIndex: number;
            seriesIndex: number;
            value: [number, number];
            color: string;
          }[];
          if (!all.length) return "";
          // the graphs share a linked axis pointer (so the cursor stays in sync
          // across channels), but the tooltip itself should only show the graph
          // actually under the cursor
          const hoverIndex = all[0].axisIndex;
          const list = all.filter((p) => p.axisIndex === hoverIndex);
          const g = GRIDS[hoverIndex];
          return C.tip(
            `${g.label.split(" ·")[0]} · ${Math.round(list[0].axisValue)} m`,
            list.map((p) => {
              const meta = seriesMeta[p.seriesIndex];
              const tag = CHANNEL_TAG[meta.key];
              const label = tag ? `${meta.carCode} ${tag}` : meta.carCode;
              return C.tipRow(label, `${p.value[1]}${CHANNEL_UNIT[meta.key]}`, { swatch: p.color });
            }),
          );
        },
      },
      grid: GRIDS.map((g) => ({
        left: 54,
        right: 20,
        top: `${g.top}%`,
        height: `${g.height}%`,
      })),
      xAxis: GRIDS.map((_, gi) =>
        C.valueAxis({
          min: 0,
          max: TRACK_LENGTH_M,
          gridIndex: gi,
          splitLine: { show: false },
          axisLabel:
            gi === GRIDS.length - 1
              ? { ...C.axisLabel, fontSize: 11, formatter: (v: number) => `${(v / 1000).toFixed(1)} km` }
              : { show: false },
        }),
      ),
      yAxis: GRIDS.map((g, gi) => {
        const dyn = dynamicRange.get(g.id);
        return C.valueAxis({
          gridIndex: gi,
          min: g.min ?? dyn?.min,
          max: g.max ?? dyn?.max,
          minInterval: g.id === "gear" ? 1 : undefined,
          splitNumber: g.splitNumber,
          axisLabel: { ...C.axisLabel, fontSize: 10.5 },
          name: g.label,
          nameTextStyle: { color: t.inkSub, fontSize: 10.5, fontFamily: MONO, align: "left", padding: [0, 0, 2, -42] },
          nameGap: 14,
        });
      }),
      series,
    };
  }, [driverA, driverB, sessionBestSec, C, t]);

  const subtitle = !driverA?.lastLap
    ? "waiting for a lap"
    : driverB?.lastLap
      ? `${driverA.code} L${driverA.lastLap.lap} (solid) vs ${driverB.code} L${driverB.lastLap.lap} (dashed) · speed / RPM / throttle+brake / gear`
      : `${driverA.code} L${driverA.lastLap.lap} · speed / RPM / throttle+brake / gear · add Car B to compare`;

  return (
    <AnalyticsCard
      eyebrow="Live · Telemetry"
      title="Car telemetry comparison"
      subtitle={subtitle}
      controls={
        props.picker && (
          <div className="flex items-center gap-1">
            <GlassSelect
              label="A"
              value={props.picker.aValue}
              options={props.picker.optionsA}
              onChange={props.picker.onPickA}
              align="right"
            />
            <GlassSelect
              label="B"
              value={props.picker.bValue}
              options={props.picker.optionsB}
              onChange={props.picker.onPickB}
              align="right"
            />
          </div>
        )
      }
      empty={!option}
      emptyText="Waiting for the car to complete its first lap."
      expandable
      className={props.className}
      bodyClassName="p-2"
    >
      {option && <EChart option={option} />}
    </AnalyticsCard>
  );
}
