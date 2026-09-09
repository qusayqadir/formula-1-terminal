/** Shapes the live dashboard consumes. Everything is produced by the
 *  simulated feed today (engine.ts); a real telemetry socket only needs to
 *  emit these same snapshots for the whole page to go live for real. */

export type TyreCompound = "SOFT" | "MEDIUM" | "HARD" | "INTER" | "WET";

export type DriverStatus = "RUNNING" | "PIT" | "RETIRED" | "FINISHED";

export interface CompletedLap {
  lap: number;
  timeSec: number;
  s1: number;
  s2: number;
  s3: number;
  compound: TyreCompound;
  tyreAgeAtLap: number;
  isOutLap: boolean;
  isPitLap: boolean;
  i1Kph: number;
  i2Kph: number;
  stKph: number;
}

export interface LiveDriverRow {
  id: number;
  code: string;
  name: string;
  teamId: number;
  teamName: string;
  color: string;
  position: number;
  /** seconds behind the race leader (0 for the leader) */
  gapToLeaderSec: number | null;
  /** seconds behind the car directly ahead */
  intervalSec: number | null;
  lapNumber: number;
  /** sector splits LOCKED IN on the lap currently in progress (the board
   *  renders these bright); null until the car crosses that split this lap.
   *  A running car never has currentS3 (S3 only completes at the line, which
   *  flips the lap) — the board fills not-yet-set cells with `lastLap` shown
   *  dim, so it's always clear which splits belong to the current lap vs the
   *  last one. Finished/retired cars carry their final lap here (all bright). */
  currentS1: number | null;
  currentS2: number | null;
  currentS3: number | null;
  /** which live sector the car is in right now (1..3) */
  activeSector: 1 | 2 | 3;
  lastLap: CompletedLap | null;
  bestLapSec: number | null;
  /** personal-best sector times, for timing-screen colouring */
  bestS: [number | null, number | null, number | null];
  compound: TyreCompound;
  tyreAgeLaps: number;
  stint: number;
  pitCount: number;
  status: DriverStatus;
  /** 0..1 position around the circuit centreline */
  trackFrac: number;
  /** full stint history including the in-progress one (endLap null) */
  stints: StintRecord[];
  /** seconds elapsed in the current stop; null unless status is "PIT" */
  pitElapsedSec: number | null;
  /** this stop's total planned duration; null unless status is "PIT" */
  pitDurationSec: number | null;
}

export interface WeatherState {
  trackTempC: number;
  airTempC: number;
  humidityPct: number;
  windSpeedMs: number;
  /** direction the wind blows FROM, degrees clockwise from north */
  windDirDeg: number;
  pressureHpa: number;
  rainRiskPct: number;
  /** track temp over the last ~10 minutes, oldest first (sparkline) */
  trackTempTrend: number[];
}

export type RaceControlCategory = "FLAG" | "CLEAR" | "DRS" | "INVESTIGATION" | "TRACK LIMITS" | "PIT" | "SESSION";

export interface RaceControlMessage {
  id: number;
  /** session clock seconds when issued */
  atSec: number;
  lap: number;
  category: RaceControlCategory;
  text: string;
}

export interface SessionBestSectors {
  s: [number | null, number | null, number | null];
  driverId: [number | null, number | null, number | null];
}

export interface LiveSnapshot {
  sessionName: string;
  circuitName: string;
  /** venue lat/lng — lets the track map centre the basemap even when no
   *  surveyed circuit geometry is available for this location. */
  circuitCenter: { lat: number; lng: number };
  clockSec: number;
  leaderLap: number;
  totalLaps: number;
  raceOver: boolean;
  drivers: LiveDriverRow[];
  sessionBest: SessionBestSectors;
  sessionBestLap: { sec: number; driverId: number } | null;
  weather: WeatherState;
  raceControl: RaceControlMessage[];
  /** full completed-lap logs, keyed by driver id (drives the comparison widgets) */
  lapLog: ReadonlyMap<number, readonly CompletedLap[]>;
  /** most recent overtakes first */
  overtakes: OvertakeEvent[];
  /** classification captured each time the race leader completes a lap —
   *  order[0] is P1's driver id. Drives the live position bump chart. */
  positionHistory: { lap: number; order: number[] }[];
  /** most recent pit stops first */
  pitStops: PitStopRecord[];
}

export interface TelemetrySample {
  /** metres from the start/finish line */
  dist: number;
  speedKph: number;
  throttlePct: number;
  brakePct: number;
  gear: number;
  rpm: number;
  drsOpen: boolean;
}

export interface TrapSpeeds {
  i1Kph: number;
  i2Kph: number;
  stKph: number;
}

export interface StintRecord {
  compound: TyreCompound;
  startLap: number;
  /** null while the stint is still in progress */
  endLap: number | null;
}

export interface OvertakeEvent {
  id: number;
  lap: number;
  atSec: number;
  passingDriverId: number;
  passedDriverId: number;
}

export interface PitStopRecord {
  id: number;
  driverId: number;
  /** the in-lap (pit) lap number */
  lap: number;
  atSec: number;
  durationSec: number;
  /** filled in once the following out-lap completes; null until then */
  outLapSec: number | null;
}
