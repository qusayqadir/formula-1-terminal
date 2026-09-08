import { useEffect, useMemo, useRef, useState } from "react";
import { GlassSelect, Segmented } from "@/components/ui/controls";
import { useLiveSession, type SimSpeed } from "./useLiveSession";
import { LiveTimingBoard } from "./widgets/LiveTimingBoard";
import { TrackMap } from "./widgets/TrackMap";
import { WeatherCard } from "./widgets/WeatherCard";
import { RaceControlFeed } from "./widgets/RaceControlFeed";
import { PositionBumpChart } from "./widgets/PositionBumpChart";
import { SpeedTrapBoard } from "./widgets/SpeedTrapBoard";
import { OvertakeMatrix } from "./widgets/OvertakeMatrix";
import { BattleSparklines } from "./widgets/BattleSparklines";
import { TyreStrategyTimeline } from "./widgets/TyreStrategyTimeline";
import { TelemetryCompare } from "./widgets/TelemetryCompare";
import { PaceTrend } from "./widgets/PaceTrend";
import { HeadToHeadPanel } from "./widgets/HeadToHeadPanel";
import { DeltaSummary } from "./widgets/DeltaSummary";
import { MinisectorStrip } from "./widgets/MinisectorStrip";
import { UndercutWindow } from "./widgets/UndercutWindow";
import { TyreDegradationCurve } from "./widgets/TyreDegradationCurve";
import { LapHistory } from "./widgets/LapHistory";
import { FieldGapChart } from "./widgets/FieldGapChart";
import { PitStopTracker } from "./widgets/PitStopTracker";
import { LiveDataToast } from "./widgets/LiveDataToast";
import type { LiveSnapshot } from "./types";

/** Live telemetry dashboard, fed by the in-browser simulated session
 *  (useLiveSession). Car A defaults to whoever is CURRENTLY LEADING and
 *  keeps following them lap to lap — picking a specific driver for A
 *  switches it to a fixed pick instead, with a "Leader (auto)" option in
 *  the dropdown to switch back. Car B is always a fixed manual pick — it's
 *  the "compare against" side of the overlay. Either slot's identity
 *  changing (including an auto leader swap) re-baselines the lap-history
 *  widget so nothing carries over from whoever used to be there.
 *
 *  Layout groups widgets by what they answer, loosely fastest-moving to
 *  most-analytical: conditions ticker → full-field classification + track →
 *  race control + the live bump chart → field-wide extras (speed trap,
 *  overtakes, battles) → strategy (tyre timeline, undercut window,
 *  degradation) → head-to-head telemetry → lap-by-lap history. Race control
 *  gets a large dedicated card since it's the higher-signal live feed;
 *  weather is a slim ticker so it stops competing with it for height. */

/** Sentinel value for the Car A dropdown's "Leader (auto)" entry — no real
 *  driver id can collide with this since roster ids start at 9200. */
const LEADER_AUTO = 0;

/** Sentinel value for the Car B dropdown's "None (off)" entry — turns the
 *  comparison overlay off (single-car view). Matches the value the select
 *  shows when bId is null (`bId ?? 0`), so "None (off)" reads as selected;
 *  safe from collision since real driver ids start at 9200. */
const COMPARE_OFF = 0;

function completedLaps(snapshot: LiveSnapshot, id: number): number {
  const log = snapshot.lapLog.get(id);
  return log && log.length ? log[log.length - 1].lap : 0;
}

function clockText(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function LiveDashboardPage() {
  const [simSpeed, setSimSpeed] = useState<SimSpeed>("1");
  const snapshot = useLiveSession(simSpeed);
  /** null = auto-follow the race leader; otherwise a fixed driver id */
  const [aOverride, setAOverride] = useState<number | null>(null);
  const [bId, setBId] = useState<number | null>(null);
  const [since, setSince] = useState<Record<number, number>>({});

  const driverA = useMemo(() => {
    if (aOverride != null) return snapshot.drivers.find((d) => d.id === aOverride) ?? null;
    return snapshot.drivers[0] ?? null; // classification is always position-sorted
  }, [snapshot, aOverride]);

  const driverB = useMemo(
    () => snapshot.drivers.find((d) => d.id === bId) ?? null,
    [snapshot, bId],
  );

  // Car B (the "compare against" car) defaults to P2 — the dashboard opens
  // comparing the leader (P1) against the runner-up (P2). Seed it once the
  // snapshot has drivers; a later manual pick (or "None (off)") overrides it.
  const bInit = useRef(false);
  useEffect(() => {
    if (bInit.current) return;
    const p2 = snapshot.drivers[1];
    if (p2) {
      setBId(p2.id);
      bInit.current = true;
    }
  }, [snapshot]);

  // whenever the ACTUAL driver occupying either slot changes — a manual
  // pick, or Car A's auto-follow switching to a new leader — re-baseline
  // that id's lap-history starting point to right now
  const prevIds = useRef<{ a: number | null; b: number | null }>({ a: null, b: null });
  useEffect(() => {
    const aId = driverA?.id ?? null;
    const bIdNow = driverB?.id ?? null;
    const prev = prevIds.current;
    if (aId !== prev.a || bIdNow !== prev.b) {
      setSince((s) => {
        const next = { ...s };
        if (aId != null && aId !== prev.a) next[aId] = completedLaps(snapshot, aId);
        if (bIdNow != null && bIdNow !== prev.b) next[bIdNow] = completedLaps(snapshot, bIdNow);
        return next;
      });
      prevIds.current = { a: aId, b: bIdNow };
    }
  }, [driverA?.id, driverB?.id, snapshot]);

  const pickA = (id: number) => {
    if (id === LEADER_AUTO) {
      setAOverride(null);
      return;
    }
    if (driverB?.id === id && driverA) setBId(driverA.id); // avoid duplicate: swap
    setAOverride(id);
  };
  const pickB = (id: number) => {
    if (id === COMPARE_OFF) {
      setBId(null); // turn the comparison overlay off — back to a single car
      return;
    }
    if (driverA?.id === id) setAOverride(null); // avoid duplicate: A reverts to auto-follow
    setBId(id);
  };

  const driverOptionsA = [
    { value: LEADER_AUTO, label: "Leader (auto)", hint: "P1" },
    ...snapshot.drivers.map((d) => ({ value: d.id, label: `P${d.position} · ${d.code}`, hint: d.teamName })),
  ];
  const driverOptionsB = [
    { value: COMPARE_OFF, label: "None (off)", hint: "single car" },
    ...snapshot.drivers.map((d) => ({ value: d.id, label: `P${d.position} · ${d.code}`, hint: d.teamName })),
  ];
  const selectedIds: [number | null, number | null] = [driverA?.id ?? null, driverB?.id ?? null];

  return (
    <div className="px-5 pb-10">
      <LiveDataToast />
      <header className="flex flex-wrap items-end justify-between gap-2 py-4">
        <div>
          <p className="eyebrow">Home / Terminal / Live</p>
          <h1 className="mt-0.5 flex items-center gap-2.5 text-lg font-semibold tracking-tight text-ink">
            Live Dashboard
            <span className="font-mono text-sm font-medium text-sub">{snapshot.sessionName}</span>
            <span className="flex items-center gap-1.5 rounded-full border border-neg/40 bg-neg/10 px-2 py-0.5">
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-neg" />
              <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-neg">Live · Sim</span>
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex h-7 items-center gap-2 rounded-md border border-stroke bg-raised px-2 font-mono text-[11px] tabular-nums text-sub">
            <span className="eyebrow !text-mut">Lap</span>
            <span className="text-ink">
              {snapshot.leaderLap}/{snapshot.totalLaps}
            </span>
            <span className="text-mut">·</span>
            {clockText(snapshot.clockSec)}
          </span>
          <GlassSelect label="Car A" value={aOverride ?? LEADER_AUTO} options={driverOptionsA} onChange={pickA} />
          <GlassSelect label="Car B" value={bId ?? 0} options={driverOptionsB} onChange={pickB} align="right" />
          <Segmented
            ariaLabel="Simulation speed"
            value={simSpeed}
            onChange={setSimSpeed}
            options={[
              { value: "1", label: "1×" },
              { value: "5", label: "5×" },
              { value: "15", label: "15×" },
            ]}
          />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-12">
        <WeatherCard snapshot={snapshot} className="h-[68px] xl:col-span-12" />

        <LiveTimingBoard snapshot={snapshot} className="h-[760px] xl:col-span-8" />
        <TrackMap snapshot={snapshot} selectedIds={selectedIds} className="h-[760px] xl:col-span-4" />

        <RaceControlFeed snapshot={snapshot} className="h-[480px] xl:col-span-5" />
        <PositionBumpChart snapshot={snapshot} selectedIds={selectedIds} className="h-[480px] xl:col-span-7" />

        <SpeedTrapBoard snapshot={snapshot} className="h-[380px] xl:col-span-4" />
        <OvertakeMatrix snapshot={snapshot} className="h-[380px] xl:col-span-4" />
        <BattleSparklines snapshot={snapshot} className="h-[380px] xl:col-span-4" />

        <FieldGapChart snapshot={snapshot} className="h-[520px] xl:col-span-7" />
        <PitStopTracker snapshot={snapshot} className="h-[520px] xl:col-span-5" />

        <TyreStrategyTimeline snapshot={snapshot} className="max-h-[560px] min-h-[280px] xl:col-span-12" />

        <UndercutWindow snapshot={snapshot} driverA={driverA} driverB={driverB} className="h-[460px] xl:col-span-6" />
        <TyreDegradationCurve
          snapshot={snapshot}
          driverA={driverA}
          driverB={driverB}
          className="h-[460px] xl:col-span-6"
        />

        <TelemetryCompare
          snapshot={snapshot}
          driverA={driverA}
          driverB={driverB}
          picker={{
            aValue: aOverride ?? LEADER_AUTO,
            bValue: bId ?? 0,
            optionsA: driverOptionsA,
            optionsB: driverOptionsB,
            onPickA: pickA,
            onPickB: pickB,
          }}
          className="h-[820px] xl:col-span-8"
        />
        <div className="flex flex-col gap-2.5 xl:col-span-4">
          <HeadToHeadPanel snapshot={snapshot} driverA={driverA} driverB={driverB} className="h-[600px]" />
          <MinisectorStrip snapshot={snapshot} driverA={driverA} driverB={driverB} className="h-[210px]" />
        </div>

        <PaceTrend snapshot={snapshot} defaultDriver={driverA} className="h-[460px] xl:col-span-12" />

        <DeltaSummary snapshot={snapshot} driverA={driverA} driverB={driverB} className="h-[168px] xl:col-span-12" />

        <LapHistory
          snapshot={snapshot}
          driverA={driverA}
          driverB={driverB}
          sinceLap={since}
          className="max-h-[560px] min-h-[220px] xl:col-span-12"
        />
      </div>
    </div>
  );
}
