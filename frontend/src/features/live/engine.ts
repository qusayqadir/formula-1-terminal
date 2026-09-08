/** Simulated live-race feed.
 *
 * Frontend-only stand-in for the OpenF1 stream the backend pipeline will
 * eventually push: one module-level engine advances a plausible race in
 * fixed 0.5 s steps and serves immutable snapshots (types.ts). Swapping in
 * the real feed means replacing useLiveSession's source, nothing else.
 *
 * Model: each driver gets a planned [s1,s2,s3] for the lap in progress
 * (base pace + fuel burn-off + tyre degradation + noise); elapsed time maps
 * through that plan onto the circuit's sector arc-fractions to give the car
 * its position on track. Gaps are distance-based (laps ahead × reference
 * lap time), which is how a real timing screen behaves between crossings.
 */

import { teamColor } from "@/lib/colors";
import {
  CIRCUIT_REAL_NAME,
  SECTOR_SPLITS,
  SECTOR_TIME_WEIGHTS,
  TOTAL_LAPS,
} from "./circuit";
import { trapSpeeds } from "./telemetry";
import type {
  CompletedLap,
  DriverStatus,
  LiveDriverRow,
  LiveSnapshot,
  OvertakeEvent,
  PitStopRecord,
  RaceControlCategory,
  RaceControlMessage,
  SessionBestSectors,
  StintRecord,
  TyreCompound,
  WeatherState,
} from "./types";

export const SESSION_NAME = "Sakhir Grand Prix · Race";
export const CIRCUIT_NAME = CIRCUIT_REAL_NAME;

/** Reference lap used to convert distance deficits to seconds — exported so
 *  the timing board can render "+N LAP" once a gap exceeds a full lap. */
export const REFERENCE_LAP_SEC = 92.4;
const BASE_LAP_SEC = REFERENCE_LAP_SEC;
/** [min,max] total pit-lane loss per stop — randomized per stop rather than
 *  a single constant so the pit-stop tracker has something real to show. */
const PIT_LOSS_RANGE: [number, number] = [20.5, 24.5];
const STEP_SEC = 0.5;

/** Team ids offset well past anything the historic DB uses so teamColor's
 *  per-id cache can't collide with real teams sharing the same numeric id. */
const TEAM_ID_BASE = 9100;

interface RosterEntry {
  code: string;
  name: string;
  team: string;
  teamSlot: number;
  /** seconds per lap slower than the reference car */
  pace: number;
}

const ROSTER: RosterEntry[] = [
  { code: "NOR", name: "Lando Norris", team: "McLaren", teamSlot: 0, pace: 0.0 },
  { code: "PIA", name: "Oscar Piastri", team: "McLaren", teamSlot: 0, pace: 0.07 },
  { code: "VER", name: "Max Verstappen", team: "Red Bull Racing", teamSlot: 1, pace: 0.09 },
  { code: "TSU", name: "Yuki Tsunoda", team: "Red Bull Racing", teamSlot: 1, pace: 0.68 },
  { code: "LEC", name: "Charles Leclerc", team: "Ferrari", teamSlot: 2, pace: 0.2 },
  { code: "HAM", name: "Lewis Hamilton", team: "Ferrari", teamSlot: 2, pace: 0.31 },
  { code: "RUS", name: "George Russell", team: "Mercedes", teamSlot: 3, pace: 0.17 },
  { code: "ANT", name: "Kimi Antonelli", team: "Mercedes", teamSlot: 3, pace: 0.44 },
  { code: "ALO", name: "Fernando Alonso", team: "Aston Martin", teamSlot: 4, pace: 0.52 },
  { code: "STR", name: "Lance Stroll", team: "Aston Martin", teamSlot: 4, pace: 0.79 },
  { code: "GAS", name: "Pierre Gasly", team: "Alpine", teamSlot: 5, pace: 0.57 },
  { code: "COL", name: "Franco Colapinto", team: "Alpine", teamSlot: 5, pace: 0.83 },
  { code: "SAI", name: "Carlos Sainz", team: "Williams", teamSlot: 6, pace: 0.41 },
  { code: "ALB", name: "Alex Albon", team: "Williams", teamSlot: 6, pace: 0.47 },
  { code: "LAW", name: "Liam Lawson", team: "Racing Bulls", teamSlot: 7, pace: 0.61 },
  { code: "HAD", name: "Isack Hadjar", team: "Racing Bulls", teamSlot: 7, pace: 0.59 },
  { code: "HUL", name: "Nico Hülkenberg", team: "Kick Sauber", teamSlot: 8, pace: 0.71 },
  { code: "BOR", name: "Gabriel Bortoleto", team: "Kick Sauber", teamSlot: 8, pace: 0.8 },
  { code: "OCO", name: "Esteban Ocon", team: "Haas", teamSlot: 9, pace: 0.64 },
  { code: "BEA", name: "Oliver Bearman", team: "Haas", teamSlot: 9, pace: 0.74 },
];

const COMPOUND_OFFSET: Record<TyreCompound, number> = {
  SOFT: -0.5,
  MEDIUM: 0,
  HARD: 0.45,
  INTER: 6,
  WET: 11,
};
const COMPOUND_DEG: Record<TyreCompound, number> = {
  SOFT: 0.085,
  MEDIUM: 0.052,
  HARD: 0.034,
  INTER: 0.05,
  WET: 0.05,
};
const STINT_LEN: Record<TyreCompound, [number, number]> = {
  SOFT: [14, 20],
  MEDIUM: [20, 27],
  HARD: [26, 34],
  INTER: [20, 30],
  WET: [20, 30],
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DriverSim {
  id: number;
  entry: RosterEntry;
  teamId: number;
  color: string;
  rng: () => number;
  status: DriverStatus;
  lapNumber: number; // lap currently in progress (1-based)
  lapElapsed: number;
  plan: [number, number, number];
  /** true when the in-progress lap ends with a pit stop (plan.s3 includes the loss) */
  pittingThisLap: boolean;
  /** this stop's total planned loss — set when pittingThisLap is scheduled */
  pitLossSec: number;
  /** finalized-record index in the engine's pitStops log awaiting this driver's out-lap time */
  pendingPitRecordId: number | null;
  doneSectors: (number | null)[]; // completed sector times of the lap in progress
  lastLap: CompletedLap | null;
  bestLapSec: number | null;
  bestS: [number | null, number | null, number | null];
  compound: TyreCompound;
  tyreAgeLaps: number;
  stint: number;
  pitCount: number;
  stintTarget: number;
  log: CompletedLap[];
  stints: StintRecord[];
  /** true when the lap about to complete is the out-lap following a pit stop */
  pendingOutLap: boolean;
  /** lap-count progress (completed + fraction), drives classification + map */
  progress: number;
  retiredAtFrac: number;
}

export class LiveRaceEngine {
  private t = 0;
  private drivers: DriverSim[] = [];
  private rng: () => number;
  private weather: WeatherState;
  private weatherClock = 0;
  private trendClock = 0;
  private rc: RaceControlMessage[] = [];
  private rcId = 0;
  private rcClock = 0;
  private pendingClear: { atSec: number; sector: number } | null = null;
  private retirements = 0;
  private sessionBest: SessionBestSectors = { s: [null, null, null], driverId: [null, null, null] };
  private sessionBestLap: { sec: number; driverId: number } | null = null;
  private raceOver = false;
  private finishCounter = 0;
  private overtakes: OvertakeEvent[] = [];
  private overtakeId = 0;
  private prevOrderIds: number[] | null = null;
  private positionHistory: { lap: number; order: number[] }[] = [];
  private lastCapturedLap = 0;
  private pitStops: PitStopRecord[] = [];
  private pitStopId = 0;

  constructor(seed = 20260907) {
    this.rng = mulberry32(seed);
    const startCompounds: TyreCompound[] = ["SOFT", "MEDIUM"];
    this.drivers = ROSTER.map((entry, i) => {
      const compound = startCompounds[i % 2 === 0 && i < 12 ? 0 : 1];
      const teamId = TEAM_ID_BASE + entry.teamSlot;
      const d: DriverSim = {
        id: 9200 + i,
        entry,
        teamId,
        color: teamColor({ id: teamId, name: entry.team, primary_color: null }),
        rng: mulberry32(seed * 31 + i * 977),
        status: "RUNNING",
        lapNumber: 1,
        // grid spread: ~1.4 s nose-to-tail down the field
        lapElapsed: -i * 1.4,
        plan: [0, 0, 0],
        pittingThisLap: false,
        pitLossSec: 0,
        pendingPitRecordId: null,
        doneSectors: [null, null],
        lastLap: null,
        bestLapSec: null,
        bestS: [null, null, null],
        compound,
        tyreAgeLaps: 0,
        stint: 1,
        pitCount: 0,
        stintTarget: 0,
        log: [],
        stints: [],
        pendingOutLap: false,
        progress: 0,
        retiredAtFrac: 0,
      };
      d.stints.push({ compound: d.compound, startLap: 1, endLap: null });
      d.stintTarget = this.rollStintTarget(d);
      d.plan = this.planLap(d);
      return d;
    });

    this.weather = {
      trackTempC: 41.5,
      airTempC: 29.2,
      humidityPct: 38,
      windSpeedMs: 3.4,
      windDirDeg: 205,
      pressureHpa: 1012,
      rainRiskPct: 10,
      trackTempTrend: [41.5],
    };
    this.pushRc("SESSION", "GREEN LIGHT — RACE START");
    this.pushRc("DRS", "DRS ENABLED");
  }

  /* ------------------------------------------------------------------ */

  private rollStintTarget(d: DriverSim): number {
    const [lo, hi] = STINT_LEN[d.compound];
    return Math.round(lo + d.rng() * (hi - lo));
  }

  private planLap(d: DriverSim): [number, number, number] {
    const fuelGain = 2.1 * (1 - (d.lapNumber - 1) / TOTAL_LAPS); // burns off toward the flag
    const deg = COMPOUND_DEG[d.compound] * d.tyreAgeLaps;
    const lap =
      BASE_LAP_SEC +
      d.entry.pace +
      COMPOUND_OFFSET[d.compound] +
      fuelGain +
      deg +
      (d.rng() - 0.5) * 0.7;
    const jitter = () => 1 + (d.rng() - 0.5) * 0.04;
    const w = SECTOR_TIME_WEIGHTS.map((x) => x * jitter());
    const sum = w[0] + w[1] + w[2];
    return [lap * (w[0] / sum), lap * (w[1] / sum), lap * (w[2] / sum)];
  }

  private completeLap(d: DriverSim) {
    const [s1, s2, s3] = d.plan;
    const time = s1 + s2 + s3;
    const wasOutLap = d.pendingOutLap;
    d.pendingOutLap = false;
    const trap = trapSpeeds(d.id, d.lapNumber, d.entry.pace);
    const rec: CompletedLap = {
      lap: d.lapNumber,
      timeSec: time,
      s1,
      s2,
      s3,
      compound: d.compound,
      tyreAgeAtLap: d.tyreAgeLaps,
      isOutLap: wasOutLap,
      isPitLap: d.pittingThisLap,
      i1Kph: trap.i1Kph,
      i2Kph: trap.i2Kph,
      stKph: trap.stKph,
    };
    d.log.push(rec);
    if (d.log.length > 90) d.log.shift();
    d.lastLap = rec;

    // this lap was the out-lap following a stop — patch the waiting record
    if (wasOutLap && d.pendingPitRecordId != null) {
      const stop = this.pitStops.find((p) => p.id === d.pendingPitRecordId);
      if (stop) stop.outLapSec = time;
      d.pendingPitRecordId = null;
    }
    // pit-in laps carry the pit loss — they never count as personal/session bests
    if (!d.pittingThisLap) {
      if (d.bestLapSec == null || time < d.bestLapSec) d.bestLapSec = time;
      const sectors = [s1, s2, s3];
      sectors.forEach((s, i) => {
        if (d.bestS[i] == null || s < (d.bestS[i] as number)) d.bestS[i] = s;
        if (this.sessionBest.s[i] == null || s < (this.sessionBest.s[i] as number)) {
          this.sessionBest.s[i] = s;
          this.sessionBest.driverId[i] = d.id;
        }
      });
      if (this.sessionBestLap == null || time < this.sessionBestLap.sec) {
        this.sessionBestLap = { sec: time, driverId: d.id };
      }
    }

    if (d.pittingThisLap) {
      d.pitCount += 1;
      d.stint += 1;
      d.tyreAgeLaps = 0;
      const lapsLeft = TOTAL_LAPS - d.lapNumber;
      d.compound = lapsLeft > 24 ? (d.rng() > 0.4 ? "MEDIUM" : "HARD") : d.rng() > 0.5 ? "SOFT" : "MEDIUM";
      d.stintTarget = this.rollStintTarget(d);
      // finalize the stint that just ended, open the next one, flag its
      // first lap as the out-lap once it completes
      d.stints[d.stints.length - 1].endLap = d.lapNumber;
      d.stints.push({ compound: d.compound, startLap: d.lapNumber + 1, endLap: null });
      d.pendingOutLap = true;
      const record: PitStopRecord = {
        id: this.pitStopId++,
        driverId: d.id,
        lap: d.lapNumber,
        atSec: this.t,
        durationSec: d.pitLossSec,
        outLapSec: null,
      };
      this.pitStops.unshift(record);
      if (this.pitStops.length > 60) this.pitStops.pop();
      d.pendingPitRecordId = record.id;
      this.pushRc("PIT", `CAR ${d.entry.code} — PIT STOP COMPLETE (STINT ${d.stint}, ${d.compound})`);
    } else {
      d.tyreAgeLaps += 1;
    }

    if (d.lapNumber >= TOTAL_LAPS) {
      d.status = "FINISHED";
      if (!this.raceOver) {
        this.raceOver = true;
        this.pushRc("SESSION", `CHEQUERED FLAG — CAR ${d.entry.code} WINS THE ${SESSION_NAME.split(" ·")[0].toUpperCase()}`);
      }
      // finishers all sit at "race distance" — a per-finisher epsilon keeps
      // the classification sorted by who crossed the line first
      d.progress = TOTAL_LAPS + (this.drivers.length - this.finishCounter++) * 1e-4;
      return;
    }

    d.lapNumber += 1;
    d.lapElapsed -= d.lastLap.timeSec;
    d.doneSectors = [null, null];
    d.pittingThisLap = d.tyreAgeLaps >= d.stintTarget && d.lapNumber < TOTAL_LAPS - 3;
    d.plan = this.planLap(d);
    if (d.pittingThisLap) {
      const [lo, hi] = PIT_LOSS_RANGE;
      d.pitLossSec = lo + d.rng() * (hi - lo);
      d.plan[2] += d.pitLossSec;
    }
  }

  /** elapsed-in-lap → lap fraction, walking the sector plan. */
  private lapFraction(d: DriverSim): number {
    const [s1, s2, s3] = d.plan;
    const e = Math.max(0, d.lapElapsed);
    const [f1, f2] = SECTOR_SPLITS;
    if (e < s1) return (e / s1) * f1;
    if (e < s1 + s2) return f1 + ((e - s1) / s2) * (f2 - f1);
    return f2 + ((e - s1 - s2) / s3) * (1 - f2);
  }

  private stepDriver(d: DriverSim, dt: number) {
    if (d.status === "RETIRED" || d.status === "FINISHED") return;
    d.lapElapsed += dt;

    // sector completions for the lap in progress
    const [s1, s2] = d.plan;
    if (d.doneSectors[0] == null && d.lapElapsed >= s1) d.doneSectors[0] = s1;
    if (d.doneSectors[1] == null && d.lapElapsed >= s1 + s2) d.doneSectors[1] = s2;

    const lapTime = d.plan[0] + d.plan[1] + d.plan[2];
    if (d.lapElapsed >= lapTime) this.completeLap(d);
    // completeLap may have just flagged the finish — re-read, don't trust narrowing
    if ((d.status as DriverStatus) !== "FINISHED") {
      d.progress = d.lapNumber - 1 + this.lapFraction(d);
    }
  }

  private maybeRetire(dt: number) {
    if (this.retirements >= 3 || this.raceOver) return;
    // ~1.5 retirements expected across the whole field over the full distance
    const perDriverPerSec = 1.5 / (this.drivers.length * TOTAL_LAPS * BASE_LAP_SEC);
    for (const d of this.drivers) {
      if (d.status !== "RUNNING" || d.lapElapsed < 0) continue;
      if (this.rng() < perDriverPerSec * dt) {
        d.status = "RETIRED";
        d.retiredAtFrac = this.lapFraction(d);
        this.retirements += 1;
        const turn = 1 + Math.floor(this.rng() * 15);
        this.pushRc("FLAG", `YELLOW FLAG — CAR ${d.entry.code} STOPPED AT TURN ${turn}`);
        this.pendingClear = { atSec: this.t + 25 + this.rng() * 30, sector: turn <= 5 ? 1 : turn <= 10 ? 2 : 3 };
        return;
      }
    }
  }

  private stepWeather(dt: number) {
    this.weatherClock += dt;
    if (this.weatherClock < 10) return;
    this.weatherClock = 0;
    const w = this.weather;
    const drift = (v: number, amp: number, lo: number, hi: number) =>
      Math.min(hi, Math.max(lo, v + (this.rng() - 0.5) * amp));
    w.trackTempC = drift(w.trackTempC, 0.5, 36, 47);
    w.airTempC = drift(w.airTempC, 0.25, 26, 32);
    w.humidityPct = drift(w.humidityPct, 1.6, 25, 60);
    w.windSpeedMs = drift(w.windSpeedMs, 0.7, 0.5, 9);
    w.windDirDeg = (w.windDirDeg + (this.rng() - 0.5) * 14 + 360) % 360;
    w.pressureHpa = drift(w.pressureHpa, 0.4, 1005, 1020);
    w.rainRiskPct = drift(w.rainRiskPct, 3, 0, 40);
  }

  private stepTrend(dt: number) {
    this.trendClock += dt;
    if (this.trendClock < 20) return;
    this.trendClock = 0;
    const trend = this.weather.trackTempTrend;
    trend.push(this.weather.trackTempC);
    if (trend.length > 30) trend.shift();
  }

  private leaderLapNow(): number {
    let max = 1;
    for (const d of this.drivers) if (d.status !== "RETIRED") max = Math.max(max, d.lapNumber);
    return Math.min(max, TOTAL_LAPS);
  }

  /** Full-field classification order, retirees dropped to the back — the
   *  same rule snapshot() uses for POS, shared so the lap-by-lap position
   *  history captured below stays consistent with the live board. */
  private classify(): DriverSim[] {
    return [...this.drivers].sort((a, b) => {
      const ra = a.status === "RETIRED" ? 1 : 0;
      const rb = b.status === "RETIRED" ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return b.progress - a.progress;
    });
  }

  /** Captures classification once each time the race leader completes a
   *  new lap — the x-axis samples for the live position bump chart. */
  private capturePositionHistory() {
    const lap = this.leaderLapNow();
    if (lap <= this.lastCapturedLap) return;
    this.lastCapturedLap = lap;
    this.positionHistory.push({ lap, order: this.classify().map((d) => d.id) });
    if (this.positionHistory.length > TOTAL_LAPS + 1) this.positionHistory.shift();
  }

  private stepRaceControl(dt: number) {
    if (this.pendingClear && this.t >= this.pendingClear.atSec) {
      this.pushRc("CLEAR", `TRACK CLEAR — SECTOR ${this.pendingClear.sector} GREEN`);
      this.pendingClear = null;
    }
    if (this.raceOver) return;
    this.rcClock += dt;
    if (this.rcClock < 45) return;
    // on average one advisory every ~2 minutes
    if (this.rng() < (this.rcClock / 120) * 0.35) {
      this.rcClock = 0;
      const running = this.drivers.filter((d) => d.status === "RUNNING");
      if (!running.length) return;
      const pick = running[Math.floor(this.rng() * running.length)];
      const turn = 1 + Math.floor(this.rng() * 15);
      const roll = this.rng();
      if (roll < 0.45) {
        this.pushRc(
          "TRACK LIMITS",
          `CAR ${pick.entry.code} — LAP ${pick.lapNumber} TURN ${turn} LAP TIME DELETED (TRACK LIMITS)`,
        );
      } else if (roll < 0.62) {
        this.pushRc("INVESTIGATION", `CAR ${pick.entry.code} UNDER INVESTIGATION — ALLEGED TRACK LIMITS TURN ${turn}`);
      } else if (roll < 0.8) {
        const backmarker = [...running].sort((a, b) => a.progress - b.progress)[0];
        this.pushRc("FLAG", `BLUE FLAG — CAR ${backmarker.entry.code} LET FASTER TRAFFIC THROUGH`);
      } else {
        this.pushRc("FLAG", `YELLOW FLAG SECTOR ${1 + Math.floor(this.rng() * 3)} — DEBRIS REPORTED TURN ${turn}`);
        this.pendingClear = { atSec: this.t + 20 + this.rng() * 25, sector: 1 };
      }
    }
  }

  /** Adjacent-swap detection: compares this step's on-track order to the
   *  previous step's. Only genuine position swaps between neighbours count
   *  as an overtake — this naturally skips pit-stop reshuffles (a car that
   *  pits drops many places in one step, which isn't a single pass). */
  private detectOvertakes() {
    const active = this.drivers.filter((d) => (d.status as DriverStatus) !== "RETIRED" && d.lapElapsed >= 0);
    const order = [...active].sort((a, b) => b.progress - a.progress).map((d) => d.id);
    if (this.prevOrderIds) {
      const prevPos = new Map(this.prevOrderIds.map((id, i) => [id, i]));
      for (let i = 0; i < order.length - 1; i++) {
        const ahead = order[i];
        const behind = order[i + 1];
        const wasAhead = prevPos.get(ahead);
        const wasBehind = prevPos.get(behind);
        if (wasAhead != null && wasBehind != null && wasAhead > wasBehind) {
          this.overtakes.unshift({
            id: this.overtakeId++,
            lap: this.leaderLapNow(),
            atSec: this.t,
            passingDriverId: ahead,
            passedDriverId: behind,
          });
          if (this.overtakes.length > 200) this.overtakes.pop();
        }
      }
    }
    this.prevOrderIds = order;
  }

  private pushRc(category: RaceControlCategory, text: string) {
    this.rc.push({ id: this.rcId++, atSec: this.t, lap: this.leaderLapNow(), category, text });
    if (this.rc.length > 48) this.rc.shift();
  }

  /* ------------------------------------------------------------------ */

  /** Advance the session by `seconds` of race time (chunked internally). */
  advance(seconds: number) {
    let remaining = seconds;
    while (remaining > 1e-9) {
      const dt = Math.min(STEP_SEC, remaining);
      remaining -= dt;
      this.t += dt;
      for (const d of this.drivers) this.stepDriver(d, dt);
      this.detectOvertakes();
      this.capturePositionHistory();
      this.maybeRetire(dt);
      this.stepWeather(dt);
      this.stepTrend(dt);
      this.stepRaceControl(dt);
    }
  }

  snapshot(): LiveSnapshot {
    // classification: distance covered, retirees to the back in drop order
    const order = this.classify();

    const leader = order[0];
    const rows: LiveDriverRow[] = order.map((d, i) => {
      const gapLaps = leader.progress - d.progress;
      const gapSec = gapLaps * BASE_LAP_SEC;
      const ahead = i > 0 ? order[i - 1] : null;
      const intervalSec = ahead ? (ahead.progress - d.progress) * BASE_LAP_SEC : null;
      const frac = d.status === "RETIRED" ? d.retiredAtFrac : this.lapFraction(d);
      const activeSector: 1 | 2 | 3 = frac < SECTOR_SPLITS[0] ? 1 : frac < SECTOR_SPLITS[1] ? 2 : 3;
      const inPitWindow = d.pittingThisLap && activeSector === 3;
      const pitElapsedSec = inPitWindow ? Math.min(d.pitLossSec, Math.max(0, d.lapElapsed - (d.plan[0] + d.plan[1]))) : null;
      return {
        id: d.id,
        code: d.entry.code,
        name: d.entry.name,
        teamId: d.teamId,
        teamName: d.entry.team,
        color: d.color,
        position: i + 1,
        gapToLeaderSec: d.status === "RETIRED" ? null : i === 0 ? 0 : gapSec,
        intervalSec: d.status === "RETIRED" ? null : intervalSec,
        lapNumber: d.lapNumber,
        currentS1: d.doneSectors[0],
        currentS2: d.doneSectors[1],
        currentS3: null,
        activeSector,
        lastLap: d.lastLap,
        bestLapSec: d.bestLapSec,
        bestS: [...d.bestS] as [number | null, number | null, number | null],
        compound: d.compound,
        tyreAgeLaps: d.tyreAgeLaps,
        stint: d.stint,
        pitCount: d.pitCount,
        status: d.status === "RUNNING" && inPitWindow ? "PIT" : d.status,
        trackFrac: frac,
        stints: d.stints.map((s) => ({ ...s })),
        pitElapsedSec,
        pitDurationSec: inPitWindow ? d.pitLossSec : null,
      };
    });

    const lapLog = new Map<number, readonly CompletedLap[]>();
    for (const d of this.drivers) lapLog.set(d.id, d.log);

    return {
      sessionName: SESSION_NAME,
      circuitName: CIRCUIT_NAME,
      clockSec: this.t,
      leaderLap: this.leaderLapNow(),
      totalLaps: TOTAL_LAPS,
      raceOver: this.raceOver,
      drivers: rows,
      sessionBest: { s: [...this.sessionBest.s], driverId: [...this.sessionBest.driverId] } as SessionBestSectors,
      sessionBestLap: this.sessionBestLap,
      weather: { ...this.weather, trackTempTrend: [...this.weather.trackTempTrend] },
      raceControl: [...this.rc].reverse(),
      lapLog,
      overtakes: [...this.overtakes],
      positionHistory: this.positionHistory.map((e) => ({ lap: e.lap, order: [...e.order] })),
      pitStops: this.pitStops.map((p) => ({ ...p })),
    };
  }
}
