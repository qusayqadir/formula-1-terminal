import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { formatLapTime } from "@/lib/format";
import { TyreBadge } from "../tyres";
import type { LiveSnapshot, TyreCompound } from "../types";

/** Three-part pit-lane view: cars currently stopped (live progress toward
 *  their stop's total planned loss), the session's finished stops —
 *  duration plus the resulting out-lap time — and a tyre-age watch list
 *  ranking every car by how deep into a plausible stint window it is. The
 *  first two sections are often empty for long stretches of a race (pit
 *  windows cluster mid-race), so the watch list is what keeps this card
 *  worth a look at any point in the session rather than mostly blank. The
 *  out-lap column stays empty until that lap actually completes, same
 *  "still in progress" convention as the rest of the live feed. */

/** Rough top-of-window stint length per compound, for the age-watch bar —
 *  matches the engine's own STINT_LEN upper bounds (not exported; these are
 *  a deliberately approximate "typical", not a precise internal value). */
const TYPICAL_MAX_STINT: Record<TyreCompound, number> = {
  SOFT: 20,
  MEDIUM: 27,
  HARD: 34,
  INTER: 30,
  WET: 30,
};

export function PitStopTracker(props: { snapshot: LiveSnapshot; className?: string }) {
  const { snapshot } = props;
  const inPit = snapshot.drivers.filter((d) => d.status === "PIT");
  const watchList = snapshot.drivers
    .filter((d) => d.status === "RUNNING")
    .map((d) => ({ d, pct: Math.min(100, (d.tyreAgeLaps / TYPICAL_MAX_STINT[d.compound]) * 100) }))
    .sort((a, b) => b.pct - a.pct);

  return (
    <AnalyticsCard
      eyebrow="Live · Pit Lane"
      title="Pit stops"
      subtitle={`${inPit.length} in the pits now · ${snapshot.pitStops.length} stop${snapshot.pitStops.length === 1 ? "" : "s"} this session`}
      empty={watchList.length === 0}
      emptyText="No cars on track yet."
      className={props.className}
      bodyClassName="flex flex-col gap-2.5 overflow-auto p-2.5"
    >
      {inPit.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="eyebrow !text-amber">In the pits</p>
          {inPit.map((d) => {
            const pct = d.pitDurationSec ? Math.min(100, ((d.pitElapsedSec ?? 0) / d.pitDurationSec) * 100) : 0;
            return (
              <div key={d.id} className="flex items-center gap-2.5 rounded-lg bg-amber/10 px-2.5 py-2">
                <span aria-hidden className="h-2 w-2 flex-none rounded-[1px]" style={{ background: d.color }} />
                <span className="w-10 flex-none font-sans text-[14px] font-medium text-ink">{d.code}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/[0.08]">
                  <span className="block h-full rounded-full bg-amber transition-[width]" style={{ width: `${pct}%` }} />
                </span>
                <span className="w-24 flex-none text-right font-mono text-[13px] tabular-nums text-amber">
                  {(d.pitElapsedSec ?? 0).toFixed(1)}s / {(d.pitDurationSec ?? 0).toFixed(1)}s
                </span>
              </div>
            );
          })}
        </div>
      )}

      {snapshot.pitStops.length > 0 && (
        <div className="flex flex-col">
          <p className="eyebrow !text-mut pb-1">Recent stops</p>
          <div className="flex items-center gap-2.5 border-b border-stroke px-1 pb-1.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mut">
            <span className="w-10">Car</span>
            <span className="w-9">Lap</span>
            <span className="w-9 text-center">Tyre</span>
            <span className="flex-1 text-right">Stop time</span>
            <span className="w-20 text-right">Out-lap</span>
          </div>
          {snapshot.pitStops.slice(0, 10).map((p) => {
            const driver = snapshot.drivers.find((d) => d.id === p.driverId);
            const stint = driver?.stints.find((s) => s.startLap === p.lap + 1);
            return (
              <div key={p.id} className="flex items-center gap-2.5 border-b border-stroke/60 px-1 py-2 last:border-0">
                <span className="flex w-10 items-center gap-1.5 font-sans text-[14px] font-medium text-ink">
                  <span aria-hidden className="h-2 w-2 flex-none rounded-[1px]" style={{ background: driver?.color ?? "transparent" }} />
                  {driver?.code ?? "—"}
                </span>
                <span className="w-9 font-mono text-[13px] tabular-nums text-sub">L{p.lap}</span>
                <span className="flex w-9 justify-center">
                  {stint ? <TyreBadge compound={stint.compound} size={16} /> : <span className="text-mut">—</span>}
                </span>
                <span className="flex-1 text-right font-mono text-[14px] font-semibold tabular-nums text-ink">
                  {p.durationSec.toFixed(1)}s
                </span>
                <span className="w-20 text-right font-mono text-[13px] tabular-nums text-sub">
                  {p.outLapSec != null ? formatLapTime(p.outLapSec) : <span className="animate-pulse text-mut">···</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </AnalyticsCard>
  );
}
