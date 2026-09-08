import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { useChartTheme } from "@/components/charts/theme";
import { formatLapTime } from "@/lib/format";
import { CIRCUIT_VIEWBOX, SECTOR_SPLITS, circuitPointAt, isInDrsZone } from "../circuit";
import { TyreBadge } from "../tyres";
import type { LiveDriverRow, LiveSnapshot } from "../types";

/** Head-to-head side panel matching the reference telemetry-analysis
 *  layout: a mini track outline colored by SECTOR (not speed — this one's
 *  about where S1/S2/S3 fall on the map, the big TrackMap widget already
 *  owns the speed heatmap), a "selected lap" info block (session
 *  conditions + DRS state), and car state (tyre/stint/pits/best). The
 *  sector-by-sector S1/S2/S3 numbers deliberately live ONLY in Lap History
 *  now (its newest row is always the latest lap) — this panel used to
 *  duplicate that exact table, which was confusing next to a widget of the
 *  same numbers one scroll away. */

const SECTOR_FRACS: [number, number][] = [
  [0, SECTOR_SPLITS[0]],
  [SECTOR_SPLITS[0], SECTOR_SPLITS[1]],
  [SECTOR_SPLITS[1], 1],
];

function sectorPath(range: [number, number], steps = 60): string {
  const [start, end] = range;
  const pts = Array.from({ length: steps + 1 }, (_, i) => circuitPointAt(start + ((end - start) * i) / steps));
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("");
}

function MiniSectorMap() {
  const { t } = useChartTheme();
  // S1/S2 use the accent + a bright neutral; S3 reuses the same amber the
  // tyre badges use for MEDIUM (fallbackSeries[3]) — no new hex introduced
  const colors = [t.accent, t.labelBright, t.fallbackSeries[3]];
  return (
    <svg viewBox={CIRCUIT_VIEWBOX} className="h-full w-full" role="img" aria-label="Sector map">
      {SECTOR_FRACS.map(([s, e], i) => (
        <path key={i} d={sectorPath([s, e])} fill="none" stroke={colors[i]} strokeWidth={16} strokeLinecap="round" opacity={0.85} />
      ))}
    </svg>
  );
}

function DriverHeader({ row }: { row: LiveDriverRow }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <span aria-hidden className="h-2 w-2 rounded-[1px]" style={{ background: row.color }} />
      <span className="font-sans text-[14px] font-medium text-ink">{row.code}</span>
    </div>
  );
}

const CAR_GRID = "grid grid-cols-[52px_1fr_1fr] items-center gap-2";

export function HeadToHeadPanel(props: {
  snapshot: LiveSnapshot;
  driverA: LiveDriverRow | null;
  driverB: LiveDriverRow | null;
  className?: string;
}) {
  const { snapshot, driverA, driverB } = props;
  const ready = driverA != null && driverB != null;

  const carRows: { label: string; render: (d: LiveDriverRow) => React.ReactNode }[] = [
    {
      label: "TYRE",
      render: (d) => (
        <span className="flex items-center justify-end gap-1.5">
          <TyreBadge compound={d.compound} size={16} />
          <span className="font-mono text-[13px] tabular-nums text-sub">{d.tyreAgeLaps} laps</span>
        </span>
      ),
    },
    { label: "STINT", render: (d) => <span className="font-mono text-[14px] tabular-nums text-ink">{d.stint}</span> },
    { label: "PITS", render: (d) => <span className="font-mono text-[14px] tabular-nums text-ink">{d.pitCount}</span> },
    {
      label: "BEST",
      render: (d) => <span className="font-mono text-[14px] tabular-nums text-ink">{formatLapTime(d.bestLapSec)}</span>,
    },
  ];

  const drsLive = ready && (isInDrsZone(driverA!.trackFrac) || isInDrsZone(driverB!.trackFrac));

  return (
    <AnalyticsCard
      eyebrow="Live · Telemetry"
      title="Head-to-head"
      subtitle={ready ? `${driverA!.code} vs ${driverB!.code} · sector-by-sector lives in Lap History` : "select two cars"}
      empty={!ready}
      emptyText="Select two cars to compare."
      className={props.className}
      bodyClassName="flex flex-col gap-2.5 p-2.5"
    >
      {ready && (
        <>
          <div className="min-h-32 flex-1 rounded-lg bg-inset">
            <MiniSectorMap />
          </div>

          <div className="flex-none flex-col">
            <div className={`${CAR_GRID} border-b border-stroke pb-1.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mut`}>
              <span />
              <DriverHeader row={driverA!} />
              <DriverHeader row={driverB!} />
            </div>
            {carRows.map((r) => (
              <div key={r.label} className={`${CAR_GRID} border-b border-stroke/60 py-2 last:border-0`}>
                <span className="font-mono text-[12px] font-semibold uppercase tracking-wider text-sub">{r.label}</span>
                <span className="text-right">{r.render(driverA!)}</span>
                <span className="text-right">{r.render(driverB!)}</span>
              </div>
            ))}
          </div>

          <div className="mt-auto rounded-lg bg-inset px-2.5 py-2">
            <p className="eyebrow !text-mut pb-1.5">Session</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[13px]">
              <dt className="text-sub">Lap</dt>
              <dd className="text-right tabular-nums text-ink">
                {snapshot.leaderLap}/{snapshot.totalLaps}
              </dd>
              <dt className="text-sub">Track temp</dt>
              <dd className="text-right tabular-nums text-ink">{snapshot.weather.trackTempC.toFixed(1)}°C</dd>
              <dt className="text-sub">Air temp</dt>
              <dd className="text-right tabular-nums text-ink">{snapshot.weather.airTempC.toFixed(1)}°C</dd>
              <dt className="text-sub">DRS</dt>
              <dd className={`text-right font-semibold ${drsLive ? "text-blue" : "text-mut"}`}>
                {drsLive ? "Active" : "Standby"}
              </dd>
            </dl>
          </div>
        </>
      )}
    </AnalyticsCard>
  );
}
