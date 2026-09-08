import { AnimatePresence, motion } from "motion/react";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { formatLapTime } from "@/lib/format";
import { REFERENCE_LAP_SEC } from "../engine";
import { TyreBadge } from "../tyres";
import type { LiveDriverRow, LiveSnapshot } from "../types";

/** Full-field live classification, same table grammar as the Race Replay
 *  standings. Columns are a CSS grid with `minmax(px, fr)` tracks, not a
 *  flex row with one stretchy name column — a single flexible column pools
 *  all the spare width from a wide card into one dead gap after the name.
 *  Sharing growth proportionally across every track instead turns that
 *  same space into wider gaps *between* every column, which reads as
 *  intentional breathing room instead of an empty hole. Sector and lap
 *  cells use timing-screen colouring — blue = session best, green =
 *  personal best — with weight carrying the signal alongside colour. */

const GRID_COLS =
  "48px 18px minmax(200px,1.5fr) minmax(96px,0.55fr) minmax(84px,0.5fr) minmax(66px,0.4fr) minmax(66px,0.4fr) minmax(66px,0.4fr) minmax(90px,0.5fr) minmax(90px,0.5fr) minmax(66px,0.4fr) minmax(56px,0.3fr) minmax(46px,0.28fr) minmax(86px,0.45fr)";

function gapText(sec: number | null): string {
  if (sec == null) return "—";
  if (sec === 0) return "LEADER";
  if (sec >= REFERENCE_LAP_SEC) return `+${Math.floor(sec / REFERENCE_LAP_SEC)} LAP`;
  return `+${sec.toFixed(3)}`;
}

function intervalText(sec: number | null): string {
  if (sec == null) return "—";
  if (sec >= REFERENCE_LAP_SEC) return `+${Math.floor(sec / REFERENCE_LAP_SEC)} LAP`;
  return `+${sec.toFixed(3)}`;
}

function surname(name: string): string {
  return name.split(" ").slice(1).join(" ") || name;
}

const EPS = 0.0005;

function SectorCell(props: {
  row: LiveDriverRow;
  index: 0 | 1 | 2;
  sessionBest: (number | null)[];
}) {
  const { row, index } = props;
  const value = index === 0 ? row.currentS1 : index === 1 ? row.currentS2 : row.currentS3;
  const live = row.status !== "RETIRED" && row.status !== "FINISHED" && row.activeSector === index + 1;
  if (value == null) {
    return (
      <span className="text-right font-mono text-[13.5px] tabular-nums text-mut">
        {live ? <span className="animate-pulse text-sub">···</span> : "—"}
      </span>
    );
  }
  const sb = props.sessionBest[index];
  const pb = row.bestS[index];
  const isSession = sb != null && value <= sb + EPS;
  const isPersonal = !isSession && pb != null && value <= pb + EPS;
  return (
    <span
      className={`text-right font-mono text-[13.5px] tabular-nums ${
        isSession ? "font-semibold text-blue" : isPersonal ? "font-semibold text-pos" : "text-sub"
      }`}
    >
      {value.toFixed(3)}
    </span>
  );
}

function statusText(row: LiveDriverRow): { label: string; cls: string } {
  switch (row.status) {
    case "RETIRED":
      return { label: "RETIRED", cls: "text-neg" };
    case "PIT":
      return { label: "IN PIT", cls: "text-amber" };
    case "FINISHED":
      return { label: "FINISHED", cls: "text-sub" };
    default:
      return { label: "RUNNING", cls: "text-mut" };
  }
}

export function LiveTimingBoard(props: { snapshot: LiveSnapshot; className?: string }) {
  const { snapshot } = props;
  const sessionBestLap = snapshot.sessionBestLap;

  return (
    <AnalyticsCard
      eyebrow="Live · Timing"
      title="Live classification"
      subtitle={`lap ${snapshot.leaderLap}/${snapshot.totalLaps} · gap / interval / sectors · sim feed`}
      expandable
      className={props.className}
      bodyClassName="overflow-auto"
    >
      <div className="min-w-[980px]">
        <div
          className="sticky top-0 z-10 grid items-center gap-2.5 border-b border-stroke bg-surface px-3 py-1.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mut"
          style={{ gridTemplateColumns: GRID_COLS }}
        >
          <span>Pos</span>
          <span />
          <span>Driver</span>
          <span className="text-right">Gap</span>
          <span className="text-right">Int</span>
          <span className="text-right">S1</span>
          <span className="text-right">S2</span>
          <span className="text-right">S3</span>
          <span className="text-right">Last</span>
          <span className="text-right">Best</span>
          <span className="text-center">Tyre</span>
          <span className="text-right">Stint</span>
          <span className="text-right">Pit</span>
          <span className="text-right">Status</span>
        </div>
        <AnimatePresence initial={false}>
          {snapshot.drivers.map((row) => {
            const status = statusText(row);
            const lastIsSessionBest =
              row.lastLap != null && sessionBestLap != null && row.lastLap.timeSec <= sessionBestLap.sec + EPS;
            const lastIsPersonalBest =
              !lastIsSessionBest &&
              row.lastLap != null &&
              row.bestLapSec != null &&
              row.lastLap.timeSec <= row.bestLapSec + EPS;
            const bestIsSessionBest =
              row.bestLapSec != null && sessionBestLap != null && row.bestLapSec <= sessionBestLap.sec + EPS;
            return (
              <motion.div
                key={row.id}
                layout
                transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.6 }}
                className={`grid items-center gap-2.5 border-b border-stroke/60 px-3 py-1.5 last:border-0 ${
                  row.status === "RETIRED" ? "opacity-50" : ""
                }`}
                style={{ gridTemplateColumns: GRID_COLS }}
              >
                <span
                  className={`font-mono text-[15px] font-semibold tabular-nums ${
                    row.status === "RETIRED" ? "text-mut" : row.position === 1 ? "text-accent" : "text-ink"
                  }`}
                >
                  {row.status === "RETIRED" ? "—" : row.position}
                </span>
                <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: row.color }} />
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="flex-none font-sans text-[15px] font-medium text-ink">{row.code}</span>
                  <span className="truncate font-sans text-[14px] text-sub">
                    {surname(row.name)}
                    <span className="text-mut"> · {row.teamName}</span>
                  </span>
                  {row.status === "PIT" && (
                    <span className="flex-none self-center rounded-sm bg-amber/15 px-1 font-mono text-[11px] font-semibold text-amber">
                      PIT
                    </span>
                  )}
                  {row.status === "RETIRED" && (
                    <span className="flex-none self-center rounded-sm bg-neg/15 px-1 font-mono text-[11px] font-semibold uppercase text-neg">
                      Retired
                    </span>
                  )}
                </span>
                <span className="text-right font-mono text-[14px] tabular-nums text-ink">
                  {gapText(row.gapToLeaderSec)}
                </span>
                <span className="text-right font-mono text-[14px] tabular-nums text-sub">
                  {row.gapToLeaderSec === 0 ? "—" : intervalText(row.intervalSec)}
                </span>
                <SectorCell row={row} index={0} sessionBest={snapshot.sessionBest.s} />
                <SectorCell row={row} index={1} sessionBest={snapshot.sessionBest.s} />
                <SectorCell row={row} index={2} sessionBest={snapshot.sessionBest.s} />
                <span
                  className={`text-right font-mono text-[14px] tabular-nums ${
                    lastIsSessionBest ? "font-semibold text-blue" : lastIsPersonalBest ? "font-semibold text-pos" : "text-ink"
                  }`}
                >
                  {formatLapTime(row.lastLap?.timeSec ?? null)}
                </span>
                <span
                  className={`text-right font-mono text-[14px] tabular-nums ${
                    bestIsSessionBest ? "font-semibold text-blue" : "text-sub"
                  }`}
                >
                  {formatLapTime(row.bestLapSec)}
                </span>
                <span className="flex items-center justify-center gap-1.5">
                  <TyreBadge compound={row.compound} size={18} />
                  <span className="font-mono text-[12.5px] tabular-nums text-mut">{row.tyreAgeLaps}</span>
                </span>
                <span className="text-right font-mono text-[14px] tabular-nums text-sub">{row.stint}</span>
                <span className="text-right font-mono text-[14px] tabular-nums text-sub">{row.pitCount}</span>
                <span className={`text-right font-mono text-[11.5px] font-semibold tracking-wider ${status.cls}`}>
                  {status.label}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </AnalyticsCard>
  );
}
