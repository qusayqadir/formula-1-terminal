import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { TYRE } from "../tyres";
import type { LiveSnapshot } from "../types";

/** Horizontal stint-by-stint strategy Gantt, one row per car in current
 *  classification order. Every bar shares the same total width (race
 *  distance so far), so stint length and stop timing compare directly
 *  across the field — the compound letter only prints once a segment is
 *  wide enough to hold it; the tooltip always carries the exact laps. */

export function TyreStrategyTimeline(props: { snapshot: LiveSnapshot; className?: string }) {
  const { snapshot } = props;
  const totalLaps = snapshot.totalLaps;

  return (
    <AnalyticsCard
      eyebrow="Live · Strategy"
      title="Tyre strategy timeline"
      subtitle={`lap ${snapshot.leaderLap}/${totalLaps} · stint compound + length per car`}
      expandable
      className={props.className}
      bodyClassName="overflow-auto p-2.5"
    >
      <div className="flex min-w-[640px] flex-col gap-[3px]">
        {snapshot.drivers.map((row) => {
          const lastEnd = row.stints.length ? (row.stints[row.stints.length - 1].endLap ?? row.lapNumber) : 0;
          const remaining = Math.max(0, totalLaps - lastEnd);
          return (
            <div key={row.id} className="flex items-center gap-2">
              <span className="flex w-32 flex-none items-center gap-1.5 font-mono text-[13px] text-ink">
                <span className="w-5 text-right text-mut">{row.position}</span>
                <span aria-hidden className="h-2 w-2 flex-none rounded-[1px]" style={{ background: row.color }} />
                <span className="truncate font-medium">{row.code}</span>
              </span>
              <div className="flex h-6 flex-1 overflow-hidden rounded-sm bg-ink/[0.03]">
                {row.stints.map((s, i) => {
                  const end = s.endLap ?? row.lapNumber;
                  const laps = Math.max(1, end - s.startLap + 1);
                  const tyre = TYRE[s.compound];
                  return (
                    <div
                      key={i}
                      title={`${s.compound} · L${s.startLap}–${end} (${laps} laps)`}
                      style={{ flexGrow: laps, background: tyre.color }}
                      className="flex h-full min-w-[3px] items-center justify-center border-r border-surface/60 last:border-r-0"
                    >
                      {laps >= 4 && (
                        <span className="font-mono text-[11px] font-bold leading-none text-black/75">
                          {tyre.letter}
                          {laps}
                        </span>
                      )}
                    </div>
                  );
                })}
                {remaining > 0 && <div style={{ flexGrow: remaining }} className="h-full" />}
              </div>
              <span className="w-16 flex-none text-right font-mono text-[12.5px] tabular-nums text-mut">
                {row.pitCount} pit{row.pitCount === 1 ? "" : "s"}
              </span>
            </div>
          );
        })}
      </div>
    </AnalyticsCard>
  );
}
