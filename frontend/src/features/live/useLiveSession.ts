/** Subscription point for the live feed. The page reads snapshots from
 *  here and nowhere else — replacing the simulated engine with a real
 *  WebSocket/SSE source is a change to this file only.
 *
 *  The engine is a module singleton so the race keeps running while the
 *  user visits other pages; it pre-simulates past the first pit-stop phase
 *  (see PRESIM_SEC) so the board opens with populated last/best laps, second
 *  stints and pit counts rather than a lap-1 green-flag train.
 */

import { useEffect, useState } from "react";
import { LiveRaceEngine, REFERENCE_LAP_SEC } from "./engine";
import type { LiveSnapshot } from "./types";

export type SimSpeed = "1" | "5" | "15";

const TICK_MS = 500;
// Join ~lap 28 — past the first round of pit stops, so the board opens with
// the field already having stopped once (pit counts, second stints, reset
// tyre ages, a populated pit-stop tracker) rather than a green-flag train.
const PRESIM_SEC = REFERENCE_LAP_SEC * 28;

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
