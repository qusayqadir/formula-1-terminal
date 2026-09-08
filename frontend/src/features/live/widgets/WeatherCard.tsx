import { MoveUp } from "lucide-react";
import { useChartTheme } from "@/components/charts/theme";
import type { LiveSnapshot } from "../types";

/** Session conditions as a single-row ticker strip — deliberately compact:
 *  race control carries the higher-signal live feed and gets the large
 *  card, so weather sits as a slim glanceable bar instead of competing for
 *  the same vertical real estate. Wind carries a rotated arrow (direction
 *  the wind blows TOWARD) alongside the numeric bearing, so direction isn't
 *  glyph-only. */

function Stat(props: { label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="eyebrow !text-mut">{props.label}</span>
      <span className="font-mono text-[14px] font-semibold tabular-nums text-ink">{props.value}</span>
      {props.extra}
    </div>
  );
}

function TrendSpark({ values }: { values: number[] }) {
  const { t } = useChartTheme();
  if (values.length < 2) return <div className="h-[22px] w-[90px]" />;
  const w = 90;
  const h = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.5);
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[22px] w-[90px] flex-none" aria-hidden>
      <polyline points={pts} fill="none" stroke={t.blue} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function WeatherCard(props: { snapshot: LiveSnapshot; className?: string }) {
  const w = props.snapshot.weather;
  const trend = w.trackTempTrend;
  const delta = trend.length > 1 ? w.trackTempC - trend[0] : 0;

  return (
    <section
      className={`flex items-center gap-5 overflow-x-auto rounded-xl border border-stroke bg-surface px-4 shadow-[var(--shadow-card)] ${props.className ?? ""}`}
    >
      <div className="flex flex-none items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-[3px] -skew-x-12 rounded-[1px] bg-accent" />
        <span className="eyebrow whitespace-nowrap !text-sub">Live · Weather</span>
      </div>
      <Stat
        label="Track"
        value={`${w.trackTempC.toFixed(1)}°C`}
        extra={
          <span
            className={`font-mono text-[12.5px] tabular-nums ${
              delta > 0.05 ? "text-pos" : delta < -0.05 ? "text-neg" : "text-mut"
            }`}
          >
            {delta > 0.05 ? `▲${delta.toFixed(1)}` : delta < -0.05 ? `▼${Math.abs(delta).toFixed(1)}` : "="}
          </span>
        }
      />
      <Stat label="Air" value={`${w.airTempC.toFixed(1)}°C`} />
      <Stat label="Humidity" value={`${Math.round(w.humidityPct)}%`} />
      <Stat
        label="Wind"
        value={`${w.windSpeedMs.toFixed(1)} m/s`}
        extra={
          <span className="flex items-center gap-1 font-mono text-[12.5px] tabular-nums text-sub">
            <MoveUp
              size={11}
              strokeWidth={2.2}
              style={{ transform: `rotate(${(w.windDirDeg + 180) % 360}deg)` }}
              aria-hidden
            />
            {Math.round(w.windDirDeg)}°
          </span>
        }
      />
      <Stat label="Pressure" value={`${w.pressureHpa.toFixed(0)} hPa`} />
      <Stat label="Rain risk" value={`${Math.round(w.rainRiskPct)}%`} />
      <div className="ml-auto flex flex-none items-center gap-2">
        <span className="eyebrow whitespace-nowrap !text-mut">Track temp · 10m</span>
        <TrendSpark values={trend} />
      </div>
    </section>
  );
}
