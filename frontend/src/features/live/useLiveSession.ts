/** Subscription point for the live feed. The page reads snapshots from
 *  here and nowhere else — replacing the simulated engine with a real
 *  WebSocket/SSE source is a change to this file only.
 *
 *  The engine is a module singleton so the race keeps running while the
 *  user visits other pages; it starts a few laps in so the board opens
 *  with populated last/best laps, stints and pit counts.
 */

import { useEffect, useState } from "react";
import { LiveRaceEngine } from "./engine";
import type { LiveSnapshot } from "./types";

export type SimSpeed = "1" | "5" | "15";

const TICK_MS = 500;
const PRESIM_SEC = 92.4 * 13.4; // join mid-race, ~lap 14

let engine: LiveRaceEngine | null = null;

function getEngine(): LiveRaceEngine {
  if (!engine) {
    engine = new LiveRaceEngine();
    engine.advance(PRESIM_SEC);
  }
  return engine;
}

export function useLiveSession(simSpeed: SimSpeed): LiveSnapshot {
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(() => getEngine().snapshot());

  useEffect(() => {
    const e = getEngine();
    const factor = Number(simSpeed);
    const id = setInterval(() => {
      e.advance((TICK_MS / 1000) * factor);
      setSnapshot(e.snapshot());
    }, TICK_MS);
    return () => clearInterval(id);
  }, [simSpeed]);

  return snapshot;
}
