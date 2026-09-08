import { useEffect, useMemo, useState } from "react";
import type { EChartsOption, SeriesOption } from "echarts";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { GlassSelect, Segmented } from "@/components/ui/controls";
import { EChart } from "@/components/charts/EChart";
import { MONO, useChartTheme } from "@/components/charts/theme";
import { formatLapTime } from "@/lib/format";
import { TYRE } from "../tyres";
import type { CompletedLap, LiveDriverRow, LiveSnapshot } from "../types";

/** Single-driver pace trend: is the chosen car getting FASTER or SLOWER as
 *  the race goes on? Plots every green-flag lap time against lap number and
 *  fits a least-squares trend line — the slope is the answer, in seconds
 *  gained (−) or lost (+) per lap. Out-laps, the in-lap (pit) and any pit
 *  lap are dropped: their warm-up / pit-loss time has nothing to do with
 *  underlying pace and would tilt the fit.
 *
 *  Raw lap times net two confounds against each other — fuel burn-off pulls
 *  times DOWN over the race, tyre wear pushes them UP within a stint — so
 *  the mode toggle lets you isolate what you're actually asking about:
 *    · Raw       — one fit over everything: the literal "faster or slower as
 *                  they progress," fuel + tyres + driver combined.
 *    · Per stint — a separate fit per stint, so each pit stop / fresh set
 *                  resets the baseline; the slope is then tyre-wear + driver
 *                  WITHIN a stint, with the between-stint fuel step removed.
 *    · Fuel-adj  — one fit over fuel-corrected times (burn-off added back at
 *                  a fixed ~0.055 s/lap), leaving tyre + driver only.
 *  Trend lines are coloured by direction: green improving, red dropping off. */

/** seconds per lap the car gains purely from burning ~1 lap of fuel — a
 *  fixed public-ballpark figure (real value is track/car dependent). Used
 *  only to strip the burn-off trend in "fuel-adjusted" mode, never claimed
 *  as exact. */
const FUEL_GAIN_PER_LAP = 0.055;

type Mode = "raw" | "stint" | "fuel";

interface PaceLap {
  lap: number;
  /** value actually plotted (raw, or fuel-corrected in fuel mode) */
  timeSec: number;
  /** always the untouched lap time, for the tooltip */
  rawSec: number;
  stintIdx: number;
  compound: CompletedLap["compound"];
}

interface Fit {
  slope: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** ordinary least squares over (lap, timeSec) — slope in s/lap plus the
 *  fitted endpoints so the trend line spans the fitted laps */
function fitTrend(pts: PaceLap[]): Fit | null {
  if (pts.length < 2) return null;
  const n = pts.length;
  const meanX = pts.reduce((s, p) => s + p.lap, 0) / n;
  const meanY = pts.reduce((s, p) => s + p.timeSec, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.lap - meanX) * (p.timeSec - meanY);
    den += (p.lap - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  const x0 = pts[0].lap;
  const x1 = pts[pts.length - 1].lap;
  return { slope, x0, x1, y0: intercept + slope * x0, y1: intercept + slope * x1 };
}

export function PaceTrend(props: {
  snapshot: LiveSnapshot;
  /** seeds the initial pick; the widget then owns its own selection */
  defaultDriver: LiveDriverRow | null;
  className?: string;
}) {
  const { snapshot, defaultDriver } = props;
  const C = useChartTheme();
  const { t } = C;

  const [pick, setPick] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("raw");
  // seed once from the page's Car A, then leave the user's pick alone
  useEffect(() => {
    if (pick == null && defaultDriver) setPick(defaultDriver.id);
  }, [pick, defaultDriver]);

  const driver = useMemo(
    () => snapshot.drivers.find((d) => d.id === pick) ?? defaultDriver ?? null,
    [snapshot.drivers, pick, defaultDriver],
  );

  // green laps for the selected car, tagged with their stint and (in fuel
  // mode) fuel-corrected. `timeSec` is what gets plotted/fitted; `rawSec`
  // stays the untouched value for the tooltip.
  const laps = useMemo<PaceLap[]>(() => {
    if (!driver) return [];
    const log = (snapshot.lapLog.get(driver.id) ?? [])
      .filter((l) => !l.isOutLap && !l.isPitLap)
      .slice()
      .sort((a, b) => a.lap - b.lap);
    if (!log.length) return [];
    const firstLap = log[0].lap;
    const stintOf = (lap: number) => {
      const i = driver.stints.findIndex((s) => lap >= s.startLap && lap <= (s.endLap ?? driver.lapNumber));
      return i < 0 ? 0 : i;
    };
    return log.map((l) => ({
      lap: l.lap,
      rawSec: l.timeSec,
      timeSec: mode === "fuel" ? l.timeSec + FUEL_GAIN_PER_LAP * (l.lap - firstLap) : l.timeSec,
      stintIdx: stintOf(l.lap),
      compound: l.compound,
    }));
  }, [snapshot.lapLog, driver, mode]);

  // per-stint groups (used by both the split lap line and the stint fits)
  const stints = useMemo(() => {
    const byStint = new Map<number, PaceLap[]>();
    for (const l of laps) {
      const arr = byStint.get(l.stintIdx);
      if (arr) arr.push(l);
      else byStint.set(l.stintIdx, [l]);
    }
    return [...byStint.entries()].sort(([a], [b]) => a - b).map(([idx, pts]) => ({ idx, pts, fit: fitTrend(pts) }));
  }, [laps]);

  const overallFit = useMemo(() => fitTrend(laps), [laps]);

  // the number that drives the headline pill: overall slope in raw/fuel
  // modes, lap-weighted mean of the per-stint slopes in stint mode
  const headlineSlope = useMemo<number | null>(() => {
    if (mode === "stint") {
      let wSum = 0;
      let n = 0;
      for (const s of stints) {
        if (!s.fit) continue;
        wSum += s.fit.slope * s.pts.length;
        n += s.pts.length;
      }
      return n ? wSum / n : null;
    }
    return overallFit?.slope ?? null;
  }, [mode, stints, overallFit]);

  const trendColor = (slope: number) => (slope < 0 ? t.pos : slope > 0 ? t.neg : t.inkSub);

  const option = useMemo<EChartsOption | null>(() => {
    if (!driver || laps.length < 2) return null;
    if (mode !== "stint" && !overallFit) return null;
    if (mode === "stint" && !stints.some((s) => s.fit)) return null;

    const color = driver.color;
    const times = laps.map((l) => l.timeSec);
    const trendYs = mode === "stint" ? stints.flatMap((s) => (s.fit ? [s.fit.y0, s.fit.y1] : [])) : [overallFit!.y0, overallFit!.y1];
    const lo = Math.min(...times, ...trendYs);
    const hi = Math.max(...times, ...trendYs);
    // tight zoom: a sub-second-per-lap drift is the whole point, so pad
    // narrowly rather than letting the axis flatten the slope
    const pad = Math.max(0.15, (hi - lo) * 0.1);

    const series: SeriesOption[] = [];

    // lap-time markers — one line per stint so the connecting stroke breaks
    // at each pit stop instead of drawing a phantom line across the gap
    stints.forEach(({ idx, pts }) => {
      series.push({
        name: driver.code,
        type: "line",
        symbol: "circle",
        symbolSize: 5,
        showSymbol: true,
        lineStyle: { width: 1.75, color },
        itemStyle: { color },
        emphasis: { disabled: true },
        data: pts.map((l) => ({ value: [l.lap, l.timeSec], rawSec: l.rawSec, stint: idx + 1 })),
        z: 2,
      });
    });

    // trend line(s): one overall, or one per stint coloured by its own slope
    const drawFit = (fit: Fit, key: string) => {
      series.push({
        name: `trend-${key}`,
        type: "line",
        showSymbol: false,
        silent: true,
        lineStyle: { width: 2, type: "dashed", color: trendColor(fit.slope) },
        emphasis: { disabled: true },
        data: [
          [fit.x0, fit.y0],
          [fit.x1, fit.y1],
        ],
        z: 3,
      });
    };
    if (mode === "stint") stints.forEach((s) => s.fit && drawFit(s.fit, String(s.idx)));
    else drawFit(overallFit!, "all");

    // faint compound-coloured band behind each stint so the per-stint resets
    // are legible without a legend (stint mode only)
    if (mode === "stint" && stints.length > 1) {
      series[0] = {
        ...series[0],
        markArea: {
          silent: true,
          itemStyle: { opacity: 0.06 },
          data: stints.map((s) => [
            { xAxis: s.pts[0].lap - 0.5, itemStyle: { color: TYRE[s.pts[0].compound].color } },
            { xAxis: s.pts[s.pts.length - 1].lap + 0.5 },
          ]),
        },
      } as SeriesOption;
    }

    return {
      animation: false,
      grid: { ...C.baseGrid, left: 52, right: 20, top: 14, bottom: 32 },
      tooltip: {
        ...C.baseTooltip,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.inkSub, width: 1, type: "dashed" } },
        formatter: (params: unknown) => {
          const list = (
            params as { seriesName: string; value: [number, number]; color: string; data?: { rawSec: number; stint: number } }[]
          ).filter((p) => !p.seriesName.startsWith("trend"));
          if (!list.length) return "";
          const p = list[0];
          const lap = p.value[0];
          const raw = p.data?.rawSec ?? p.value[1];
          // fuel mode plots a corrected time — show it, with raw in parens
          const valueText =
            mode === "fuel" ? `${formatLapTime(p.value[1])} (raw ${formatLapTime(raw)})` : formatLapTime(raw);
          return C.tip(`LAP ${lap}${p.data ? ` · stint ${p.data.stint}` : ""}`, [
            C.tipRow(driver.code, valueText, { swatch: p.color }),
          ]);
        },
      },
      xAxis: C.valueAxis({
        name: "LAP",
        nameLocation: "middle",
        nameGap: 22,
        nameTextStyle: { color: t.inkSub, fontFamily: MONO, fontSize: 10 },
        minInterval: 1,
      }),
      yAxis: C.valueAxis({
        min: Math.floor((lo - pad) * 10) / 10,
        max: Math.ceil((hi + pad) * 10) / 10,
        name: mode === "fuel" ? "FUEL-ADJ TIME · S" : "LAP TIME · S",
        nameTextStyle: { color: t.inkSub, fontFamily: MONO, fontSize: 10, align: "left" },
        nameGap: 14,
      }),
      series,
    };
  }, [driver, laps, mode, stints, overallFit, C, t]);

  const options = snapshot.drivers.map((d) => ({
    value: d.id,
    label: `P${d.position} · ${d.code}`,
    hint: d.teamName,
  }));

  // headline verdict pill: the mode's slope, direction-coloured
  const verdict =
    headlineSlope != null
      ? (() => {
          const gaining = headlineSlope < -0.002;
          const losing = headlineSlope > 0.002;
          const tone = gaining ? "text-pos" : losing ? "text-neg" : "text-sub";
          const glyph = gaining ? "▲" : losing ? "▼" : "▬";
          const sign = headlineSlope < 0 ? "−" : headlineSlope > 0 ? "+" : "±";
          const word = gaining ? "gaining" : losing ? "losing" : "holding";
          return { tone, glyph, word, text: `${sign}${Math.abs(headlineSlope).toFixed(3)} s/lap` };
        })()
      : null;

  const modeTail =
    mode === "raw"
      ? "raw lap times · fuel + tyres"
      : mode === "stint"
        ? "per-stint slope · fuel resets removed"
        : `fuel-adjusted (~${FUEL_GAIN_PER_LAP.toFixed(3)} s/lap) · tyres + driver`;

  const subtitle = driver
    ? verdict
      ? `${driver.code} · ${laps.length} green laps · ${verdict.word} pace · ${modeTail}`
      : `${driver.code} · not enough green laps yet`
    : "select a car";

  return (
    <AnalyticsCard
      eyebrow="Live · Telemetry"
      title="Driver pace trend"
      subtitle={subtitle}
      controls={
        <div className="flex items-center gap-2">
          <Segmented
            ariaLabel="Pace trend basis"
            value={mode}
            onChange={setMode}
            options={[
              { value: "raw", label: "Raw" },
              { value: "stint", label: "Per stint" },
              { value: "fuel", label: "Fuel-adj" },
            ]}
          />
          {verdict && (
            <span
              className={`flex items-center gap-1 rounded-md border border-stroke bg-raised px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${verdict.tone}`}
            >
              <span aria-hidden>{verdict.glyph}</span>
              {verdict.text}
            </span>
          )}
          <GlassSelect label="Car" value={driver?.id ?? 0} options={options} onChange={(v) => setPick(v)} align="right" />
        </div>
      }
      empty={!option}
      emptyText="Needs at least two green-flag laps from the selected car."
      expandable
      className={props.className}
      bodyClassName="p-2"
    >
      {option && <EChart option={option} />}
    </AnalyticsCard>
  );
}
