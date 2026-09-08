import { useMemo } from "react";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { withAlpha } from "@/lib/colors";
import { compareColor } from "../compareColors";
import { minisectorTimes } from "../telemetry";
import type { LiveDriverRow, LiveSnapshot } from "../types";

/** F1TV-style microsector dominance strip, restricted to the two compared
 *  cars (a full 20-car version would be illegible at this width — this is
 *  deliberately a head-to-head tool). The lap is split into fixed-distance
 *  buckets; each bucket is colored by whichever car was faster through it,
 *  using that car's own identity colour (not a fixed purple/green) so it
 *  reads consistently with every other widget on the page. When the two are
 *  team-mates (identical team hue) compareColor lightens car B so the strip
 *  and legend stay tellable apart instead of one flat block of colour. */

const BUCKETS = 28;

export function MinisectorStrip(props: {
  snapshot: LiveSnapshot;
  driverA: LiveDriverRow | null;
  driverB: LiveDriverRow | null;
  className?: string;
}) {
  const { snapshot, driverA, driverB } = props;

  const result = useMemo(() => {
    if (!driverA?.lastLap || !driverB?.lastLap) return null;
    const sessionBestSec = snapshot.sessionBestLap?.sec ?? null;
    const paceOf = (row: LiveDriverRow) =>
      sessionBestSec != null && row.bestLapSec != null ? Math.max(0, row.bestLapSec - sessionBestSec) : 0.4;

    const timesA = minisectorTimes(driverA.id, driverA.lastLap.lap, paceOf(driverA), BUCKETS);
    const timesB = minisectorTimes(driverB.id, driverB.lastLap.lap, paceOf(driverB), BUCKETS);
    const buckets = timesA.map((ta, i) => {
      const tb = timesB[i];
      const winner: "a" | "b" = ta <= tb ? "a" : "b";
      const deltaMs = Math.abs(ta - tb) * 1000;
      return { winner, deltaMs };
    });
    const wonA = buckets.filter((b) => b.winner === "a").length;
    return { buckets, wonA, wonB: BUCKETS - wonA };
  }, [snapshot.sessionBestLap, driverA, driverB]);

  const ready = driverA != null && driverB != null;
  // team-mates share a hue — lighten B (compareColor) so A and B are tellable
  // apart in the legend and every split fill
  const colorA = driverA && driverB ? compareColor("a", driverA, driverB) : driverA?.color;
  const colorB = driverA && driverB ? compareColor("b", driverA, driverB) : driverB?.color;

  return (
    <AnalyticsCard
      eyebrow="Live · Telemetry"
      title="Minisector dominance"
      subtitle={ready ? `${driverA.code} vs ${driverB.code} · ${BUCKETS} splits · latest laps` : "select two cars"}
      empty={!result}
      emptyText="Waiting for both cars to complete a lap."
      className={props.className}
      bodyClassName="flex flex-col justify-center gap-2 p-2.5"
    >
      {result && driverA && driverB && (
        <>
          <div className="flex items-center justify-between font-mono text-[13px] tabular-nums text-sub">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-[1px]" style={{ background: colorA }} />
              {driverA.code} · {result.wonA} splits
            </span>
            <span className="flex items-center gap-1.5">
              {driverB.code} · {result.wonB} splits
              <span aria-hidden className="h-2 w-2 rounded-[1px]" style={{ background: colorB }} />
            </span>
          </div>
          <div className="flex h-8 w-full gap-[1.5px] overflow-hidden rounded-md">
            {result.buckets.map((b, i) => {
              const color = b.winner === "a" ? colorA! : colorB!;
              // stronger fill for a bigger swing, faint wash for a near-tie
              const alpha = Math.max(0.35, Math.min(1, 0.35 + b.deltaMs / 220));
              return (
                <div
                  key={i}
                  title={`Split ${i + 1} · ${b.winner === "a" ? driverA.code : driverB.code} by ${b.deltaMs.toFixed(0)}ms`}
                  className="h-full flex-1"
                  style={{ background: withAlpha(color, alpha) }}
                />
              );
            })}
          </div>
          <p className="font-mono text-[11.5px] leading-relaxed text-mut">
            Each split colored by whichever car was quicker through it — solid fill = a bigger margin, faint = a
            near-tie. Start/finish on the left, one lap per side's most recent completed lap.
          </p>
        </>
      )}
    </AnalyticsCard>
  );
}
