import { useMemo } from "react";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { useChartTheme } from "@/components/charts/theme";
import type { CompletedLap, LiveSnapshot } from "../types";

/** Small multiples for every on-track battle right now (adjacent cars
 *  within a DRS-range-ish interval) — independent of the A/B comparison
 *  selection, since a close fight for P11 is just as worth surfacing as
 *  whatever pair happens to be selected above. The trend line is each
 *  pair's cumulative-time gap over their last few common laps (same
 *  technique as the undercut-window widget) — is the trailing car actually
 *  closing, or just momentarily near? */

const BATTLE_THRESHOLD_SEC = 1.6;
const TREND_LAPS = 8;

function cumulativeByLap(log: readonly CompletedLap[]): Map<number, number> {
  let sum = 0;
  const map = new Map<number, number>();
  for (const l of log) {
    sum += l.timeSec;
    map.set(l.lap, sum);
  }
  return map;
}

function Spark({ points, color }: { points: number[]; color: string }) {
  const w = 120;
  const h = 26;
  if (points.length < 2) return <svg viewBox={`0 0 ${w} ${h}`} className="h-[26px] w-full" aria-hidden />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 0.05);
  const path = points
    .map((v, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[26px] w-full" aria-hidden>
      <polyline points={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function BattleSparklines(props: { snapshot: LiveSnapshot; className?: string }) {
  const { snapshot } = props;
  const { t } = useChartTheme();

  const battles = useMemo(() => {
    const running = snapshot.drivers.filter((d) => d.status === "RUNNING" || d.status === "PIT");
    const pairs: {
      ahead: (typeof running)[number];
      behind: (typeof running)[number];
      intervalSec: number;
      trend: number[];
      closing: boolean;
    }[] = [];
    for (let i = 0; i < running.length - 1; i++) {
      const ahead = running[i];
      const behind = running[i + 1];
      if (behind.intervalSec == null || behind.intervalSec > BATTLE_THRESHOLD_SEC) continue;
      const cumAhead = cumulativeByLap(snapshot.lapLog.get(ahead.id) ?? []);
      const cumBehind = cumulativeByLap(snapshot.lapLog.get(behind.id) ?? []);
      const laps = [...cumAhead.keys()].filter((l) => cumBehind.has(l)).sort((a, b) => a - b).slice(-TREND_LAPS);
      const trend = laps.map((l) => (cumBehind.get(l) as number) - (cumAhead.get(l) as number));
      const closing = trend.length >= 2 ? trend[trend.length - 1] < trend[0] : false;
      pairs.push({ ahead, behind, intervalSec: behind.intervalSec, trend, closing });
    }
    return pairs.sort((a, b) => a.intervalSec - b.intervalSec).slice(0, 7);
  }, [snapshot.drivers, snapshot.lapLog]);

  return (
    <AnalyticsCard
      eyebrow="Live · Race"
      title="Battles on track"
      subtitle={`interval < ${BATTLE_THRESHOLD_SEC.toFixed(1)}s · trend = last ${TREND_LAPS} common laps`}
      empty={battles.length === 0}
      emptyText="No cars within striking distance of each other right now."
      className={props.className}
      bodyClassName="flex flex-col gap-2 p-2.5"
    >
      {battles.map(({ ahead, behind, intervalSec, trend, closing }) => (
        <div key={`${ahead.id}-${behind.id}`} className="flex items-center gap-2.5 rounded-lg bg-inset px-2.5 py-1.5">
          <div className="flex w-24 flex-none flex-col gap-0.5 font-mono text-[13px]">
            <span className="flex items-center gap-1.5 text-ink">
              <span aria-hidden className="h-2 w-2 rounded-[1px]" style={{ background: ahead.color }} />
              P{ahead.position} {ahead.code}
            </span>
            <span className="flex items-center gap-1.5 text-sub">
              <span aria-hidden className="h-2 w-2 rounded-[1px]" style={{ background: behind.color }} />
              P{behind.position} {behind.code}
            </span>
          </div>
          <Spark points={trend} color={closing ? t.pos : t.neg} />
          <div className="flex w-16 flex-none flex-col items-end gap-0.5">
            <span className="font-mono text-[14px] font-semibold tabular-nums text-ink">+{intervalSec.toFixed(3)}</span>
            <span className={`font-mono text-[11px] font-semibold uppercase ${closing ? "text-pos" : "text-neg"}`}>
              {closing ? "▼ closing" : "▲ opening"}
            </span>
          </div>
        </div>
      ))}
      {battles.length > 0 && (
        <p className="mt-auto pt-1 text-center font-mono text-[11px] text-mut">
          {battles.length} battle{battles.length === 1 ? "" : "s"} within {BATTLE_THRESHOLD_SEC.toFixed(1)}s right now
        </p>
      )}
    </AnalyticsCard>
  );
}
