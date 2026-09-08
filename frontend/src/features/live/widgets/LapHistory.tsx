import { useMemo, useState } from "react";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { Segmented } from "@/components/ui/controls";
import { formatLapTime } from "@/lib/format";
import { TyreBadge } from "../tyres";
import type { CompletedLap, LiveDriverRow, LiveSnapshot } from "../types";

/** Lap-by-lap log for the compared pair, accumulated only while THIS pair
 *  is selected: `sinceLap` is each car's completed-lap count at the moment
 *  the pair was chosen, so switching drivers wipes the table by
 *  construction (nothing is kept from a previous comparison). Columns
 *  distribute evenly across the card — each driver block is a fixed grid,
 *  so the delta column never drifts away from the data. A second tab
 *  rolls the same lap log up into a per-stint summary (matches the
 *  reference's Lap History / Stint Summary tab pair). */

const GROUP_GRID = "grid flex-1 grid-cols-[1.15fr_1fr_1fr_1fr_44px] items-center gap-2";
const STINT_GRID = "grid flex-1 grid-cols-[0.7fr_1fr_1fr_1fr_1fr] items-center gap-2";

type Tab = "history" | "stints";

function LapCells({ lap }: { lap: CompletedLap | null }) {
  return (
    <>
      <span className="text-right font-mono text-[14px] font-semibold tabular-nums text-ink">
        {lap ? formatLapTime(lap.timeSec) : "—"}
      </span>
      {(["s1", "s2", "s3"] as const).map((k) => (
        <span key={k} className="text-right font-mono text-[13px] tabular-nums text-sub">
          {lap ? lap[k].toFixed(3) : "—"}
        </span>
      ))}
      <span className="flex justify-center">
        {lap ? <TyreBadge compound={lap.compound} size={17} /> : <span className="font-mono text-[13px] text-mut">—</span>}
      </span>
    </>
  );
}

interface StintRow {
  number: number;
  compound: CompletedLap["compound"];
  startLap: number;
  endLap: number;
  lapCount: number;
  avgSec: number | null;
  bestSec: number | null;
}

function stintRows(row: LiveDriverRow, log: readonly CompletedLap[]): StintRow[] {
  return row.stints.map((s, i) => {
    const end = s.endLap ?? row.lapNumber;
    const greenLaps = log.filter((l) => l.lap >= s.startLap && l.lap <= end && !l.isOutLap && !l.isPitLap);
    const avgSec = greenLaps.length ? greenLaps.reduce((sum, l) => sum + l.timeSec, 0) / greenLaps.length : null;
    const bestSec = greenLaps.length ? Math.min(...greenLaps.map((l) => l.timeSec)) : null;
    return { number: i + 1, compound: s.compound, startLap: s.startLap, endLap: end, lapCount: end - s.startLap + 1, avgSec, bestSec };
  });
}

function StintCells({ s }: { s: StintRow }) {
  return (
    <>
      <span className="flex items-center gap-1.5 font-mono text-[13px] tabular-nums text-ink">
        <TyreBadge compound={s.compound} size={16} />#{s.number}
      </span>
      <span className="text-right font-mono text-[13px] tabular-nums text-sub">
        L{s.startLap}–{s.endLap} ({s.lapCount})
      </span>
      <span className="text-right font-mono text-[14px] tabular-nums text-ink">{formatLapTime(s.avgSec)}</span>
      <span className="text-right font-mono text-[14px] font-semibold tabular-nums text-blue">{formatLapTime(s.bestSec)}</span>
      <span />
    </>
  );
}

export function LapHistory(props: {
  snapshot: LiveSnapshot;
  driverA: LiveDriverRow | null;
  driverB: LiveDriverRow | null;
  /** completed-lap count per driver id at selection time; laps ≤ this are hidden */
  sinceLap: Record<number, number>;
  className?: string;
}) {
  const { snapshot, driverA, driverB, sinceLap } = props;
  const [tab, setTab] = useState<Tab>("history");

  const rows = useMemo(() => {
    if (!driverA || !driverB) return [];
    const logA = snapshot.lapLog.get(driverA.id) ?? [];
    const logB = snapshot.lapLog.get(driverB.id) ?? [];
    const fromA = sinceLap[driverA.id] ?? 0;
    const fromB = sinceLap[driverB.id] ?? 0;
    const byLap = new Map<number, { a: CompletedLap | null; b: CompletedLap | null }>();
    for (const l of logA) {
      if (l.lap > fromA) byLap.set(l.lap, { a: l, b: null });
    }
    for (const l of logB) {
      if (l.lap <= fromB) continue;
      const hit = byLap.get(l.lap);
      if (hit) hit.b = l;
      else byLap.set(l.lap, { a: null, b: l });
    }
    return [...byLap.entries()]
      .sort(([x], [y]) => y - x) // newest lap on top
      .map(([lap, pair]) => ({ lap, ...pair }));
  }, [snapshot.lapLog, driverA, driverB, sinceLap]);

  const stintsA = useMemo(() => {
    if (!driverA) return [];
    return stintRows(driverA, snapshot.lapLog.get(driverA.id) ?? []);
  }, [driverA, snapshot.lapLog]);
  const stintsB = useMemo(() => {
    if (!driverB) return [];
    return stintRows(driverB, snapshot.lapLog.get(driverB.id) ?? []);
  }, [driverB, snapshot.lapLog]);
  const maxStintRows = Math.max(stintsA.length, stintsB.length);

  const ready = driverA != null && driverB != null;

  const groupHeader = (row: LiveDriverRow | null, fallback: string) => (
    <span className={GROUP_GRID}>
      <span className="flex items-center justify-end gap-1.5">
        {row && <span aria-hidden className="h-2 w-2 rounded-[1px]" style={{ background: row.color }} />}
        <span className="text-sub">{row?.code ?? fallback}</span>
      </span>
      <span className="text-right">S1</span>
      <span className="text-right">S2</span>
      <span className="text-right">S3</span>
      <span className="text-center">Tyre</span>
    </span>
  );

  const stintHeader = (row: LiveDriverRow | null, fallback: string) => (
    <span className={STINT_GRID}>
      <span className="text-sub">{row?.code ?? fallback}</span>
      <span className="text-right">Laps</span>
      <span className="text-right">Avg</span>
      <span className="text-right">Best</span>
      <span />
    </span>
  );

  const isEmpty = tab === "history" ? !ready || rows.length === 0 : !ready || maxStintRows === 0;

  return (
    <AnalyticsCard
      eyebrow="Live · Comparison"
      title={tab === "history" ? "Lap history" : "Stint summary"}
      subtitle={
        ready
          ? tab === "history"
            ? `${driverA.code} vs ${driverB.code} · laps completed since this pair was selected · Δ = ${driverA.code} − ${driverB.code}`
            : `${driverA.code} vs ${driverB.code} · avg/best exclude out- and in-laps`
          : "select two cars"
      }
      controls={
        <Segmented
          ariaLabel="Lap history view"
          value={tab}
          onChange={setTab}
          options={[
            { value: "history", label: "Lap History" },
            { value: "stints", label: "Stint Summary" },
          ]}
        />
      }
      empty={isEmpty}
      emptyText={
        tab === "history"
          ? "No full laps recorded for this pairing yet — the table fills as both cars cross the line, and clears when the selection changes."
          : "No completed stints yet for this pairing."
      }
      className={props.className}
      bodyClassName="overflow-auto"
    >
      {tab === "history" ? (
        <div className="min-w-[880px]">
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-stroke bg-surface px-2.5 py-2 font-mono text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mut">
            <span className="w-9">Lap</span>
            {groupHeader(driverA, "car a")}
            <span aria-hidden className="h-5 w-px bg-stroke" />
            {groupHeader(driverB, "car b")}
            <span className="w-[76px] text-right">Δ A−B</span>
          </div>
          {rows.map((r) => {
            const delta = r.a && r.b ? r.a.timeSec - r.b.timeSec : null;
            return (
              <div key={r.lap} className="flex items-center gap-3 border-b border-stroke/60 px-2.5 py-2 last:border-0">
                <span className="w-9 font-mono text-[14px] font-semibold tabular-nums text-ink">L{r.lap}</span>
                <span className={GROUP_GRID}>
                  <LapCells lap={r.a} />
                </span>
                <span aria-hidden className="h-5 w-px bg-stroke/60" />
                <span className={GROUP_GRID}>
                  <LapCells lap={r.b} />
                </span>
                <span
                  className={`w-[76px] text-right font-mono text-[14px] font-semibold tabular-nums ${
                    delta == null ? "text-mut" : Math.abs(delta) < 0.0005 ? "text-mut" : delta < 0 ? "text-pos" : "text-neg"
                  }`}
                >
                  {delta == null
                    ? "—"
                    : Math.abs(delta) < 0.0005
                      ? "0.000"
                      : `${delta < 0 ? "▲−" : "▼+"}${Math.abs(delta).toFixed(3)}`}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="min-w-[640px]">
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-stroke bg-surface px-2.5 py-2 font-mono text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mut">
            {stintHeader(driverA, "car a")}
            <span aria-hidden className="h-5 w-px bg-stroke" />
            {stintHeader(driverB, "car b")}
          </div>
          {Array.from({ length: maxStintRows }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-stroke/60 px-2.5 py-2 last:border-0">
              <span className={STINT_GRID}>{stintsA[i] ? <StintCells s={stintsA[i]} /> : <span className="col-span-5 text-mut">—</span>}</span>
              <span aria-hidden className="h-5 w-px bg-stroke/60" />
              <span className={STINT_GRID}>{stintsB[i] ? <StintCells s={stintsB[i]} /> : <span className="col-span-5 text-mut">—</span>}</span>
            </div>
          ))}
        </div>
      )}
    </AnalyticsCard>
  );
}
