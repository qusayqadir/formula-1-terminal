import { useMemo } from "react";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { Lightbulb } from "lucide-react";
import { SECTOR_SPLITS, TRACK_LENGTH_M } from "../circuit";
import { telemetryLap } from "../telemetry";
import type { LiveDriverRow, LiveSnapshot } from "../types";

/** The delta callouts + auto-generated "key insight" row from the reference
 *  telemetry layout — sits directly under the main chart. Each tile is a
 *  plain signed number (matches the "X faster on lap N" reference styling);
 *  the insight text is genuinely computed from telemetry (minimum speed and
 *  average throttle within whichever sector shows the biggest delta), not
 *  a canned string — if the two cars are essentially tied, it says so
 *  instead of manufacturing a reason. */

const SECTOR_RANGES: [number, number][] = [
  [0, SECTOR_SPLITS[0]],
  [SECTOR_SPLITS[0], SECTOR_SPLITS[1]],
  [SECTOR_SPLITS[1], 1],
];

function paceOffset(row: LiveDriverRow, sessionBestSec: number | null): number {
  return sessionBestSec != null && row.bestLapSec != null ? Math.max(0, row.bestLapSec - sessionBestSec) : 0.4;
}

function DeltaTile(props: { label: string; delta: number | null; fasterCode: string | null; lap: number | null }) {
  const { label, delta, fasterCode, lap } = props;
  const tie = delta != null && Math.abs(delta) < 0.0005;
  return (
    <div className="flex flex-1 flex-col justify-center rounded-lg bg-inset px-3 py-2.5">
      <p className="eyebrow !text-mut">{label}</p>
      {delta == null ? (
        <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-mut">—</p>
      ) : (
        <>
          <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tie ? "text-mut" : delta < 0 ? "text-pos" : "text-neg"}`}>
            {tie ? "0.000s" : `${delta < 0 ? "−" : "+"}${Math.abs(delta).toFixed(3)}s`}
          </p>
          <p className="mt-0.5 font-mono text-[12.5px] text-sub">
            {tie ? "dead even" : `${fasterCode} faster${lap != null ? ` on lap ${lap}` : ""}`}
          </p>
        </>
      )}
    </div>
  );
}

export function DeltaSummary(props: {
  snapshot: LiveSnapshot;
  driverA: LiveDriverRow | null;
  driverB: LiveDriverRow | null;
  className?: string;
}) {
  const { snapshot, driverA, driverB } = props;

  const built = useMemo(() => {
    if (!driverA?.lastLap || !driverB?.lastLap) return null;
    const a = driverA.lastLap;
    const b = driverB.lastLap;
    const deltas = { lap: a.timeSec - b.timeSec, s1: a.s1 - b.s1, s2: a.s2 - b.s2, s3: a.s3 - b.s3 };

    const sectorDeltas = [deltas.s1, deltas.s2, deltas.s3];
    let worstIdx = 0;
    for (let i = 1; i < 3; i++) if (Math.abs(sectorDeltas[i]) > Math.abs(sectorDeltas[worstIdx])) worstIdx = i;
    const worstDelta = sectorDeltas[worstIdx];

    let insight: string;
    if (Math.abs(worstDelta) < 0.02) {
      insight = `${driverA.code} and ${driverB.code} are within hundredths across every sector on their latest laps — no meaningful edge either way right now.`;
    } else {
      const winner = worstDelta < 0 ? driverA : driverB;
      const loser = worstDelta < 0 ? driverB : driverA;
      const sessionBestSec = snapshot.sessionBestLap?.sec ?? null;
      const winnerLap = winner.lastLap!.lap;
      const loserLap = loser.lastLap!.lap;
      const samplesWinner = telemetryLap(winner.id, winnerLap, paceOffset(winner, sessionBestSec));
      const samplesLoser = telemetryLap(loser.id, loserLap, paceOffset(loser, sessionBestSec));
      const [rs, re] = SECTOR_RANGES[worstIdx];
      const lo = rs * TRACK_LENGTH_M;
      const hi = re * TRACK_LENGTH_M;
      const segWinner = samplesWinner.filter((s) => s.dist >= lo && s.dist <= hi);
      const segLoser = samplesLoser.filter((s) => s.dist >= lo && s.dist <= hi);
      const minSpeedWinner = Math.min(...segWinner.map((s) => s.speedKph));
      const minSpeedLoser = Math.min(...segLoser.map((s) => s.speedKph));
      const avgThrottleWinner = segWinner.reduce((s, x) => s + x.throttlePct, 0) / segWinner.length;
      const avgThrottleLoser = segLoser.reduce((s, x) => s + x.throttlePct, 0) / segLoser.length;

      const reasons: string[] = [];
      if (minSpeedLoser < minSpeedWinner - 3) {
        reasons.push(`a lower minimum speed (${minSpeedLoser.toFixed(0)} vs ${minSpeedWinner.toFixed(0)} kph)`);
      }
      if (avgThrottleLoser < avgThrottleWinner - 4) {
        reasons.push("later throttle application through the corner exits");
      }
      const reasonText = reasons.length ? `, mainly due to ${reasons.join(" and ")}` : "";

      insight = `${loser.code} is losing most of its time to ${winner.code} in Sector ${worstIdx + 1} (${Math.abs(worstDelta).toFixed(3)}s on the last lap)${reasonText}.`;
    }

    return { deltas, insight };
  }, [snapshot.sessionBestLap, driverA, driverB]);

  const ready = driverA != null && driverB != null;
  const lap = driverA?.lastLap?.lap ?? null;

  return (
    <AnalyticsCard
      eyebrow="Live · Telemetry"
      title="Delta summary"
      subtitle={ready ? `${driverA!.code} − ${driverB!.code} · latest completed lap` : "select two cars"}
      empty={!built}
      emptyText="Waiting for both cars to complete a lap."
      className={props.className}
      bodyClassName="flex items-stretch gap-3 p-2.5"
    >
      {built && driverA && driverB && (
        <>
          <DeltaTile
            label="Lap Delta"
            delta={built.deltas.lap}
            fasterCode={built.deltas.lap < 0 ? driverA.code : driverB.code}
            lap={lap}
          />
          <DeltaTile
            label="S1 Delta"
            delta={built.deltas.s1}
            fasterCode={built.deltas.s1 < 0 ? driverA.code : driverB.code}
            lap={lap}
          />
          <DeltaTile
            label="S2 Delta"
            delta={built.deltas.s2}
            fasterCode={built.deltas.s2 < 0 ? driverA.code : driverB.code}
            lap={lap}
          />
          <DeltaTile
            label="S3 Delta"
            delta={built.deltas.s3}
            fasterCode={built.deltas.s3 < 0 ? driverA.code : driverB.code}
            lap={lap}
          />
          <div className="flex flex-[1.6] items-start gap-2.5 rounded-lg border border-stroke-strong bg-inset px-3 py-2.5">
            <Lightbulb size={15} strokeWidth={1.8} className="mt-0.5 flex-none text-amber" />
            <div className="min-w-0">
              <p className="eyebrow !text-amber">Key insight</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink">{built.insight}</p>
            </div>
          </div>
        </>
      )}
    </AnalyticsCard>
  );
}
