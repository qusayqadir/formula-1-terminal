/** Per-lap car telemetry synthesised from the circuit's curvature profile.
 *
 * Classic speed-profile construction: each sample gets a cornering speed
 * limit from local curvature (v = √(a_lat/κ)), then a forward pass caps
 * acceleration and a backward pass caps braking, both wrapping the lap so
 * the profile is continuous across the line. Throttle / brake / gear are
 * derived from the resulting dv. Deterministic per (driver, lap) so the
 * comparison chart is stable between ticks and differs subtly per driver.
 */

import { CIRCUIT_SAMPLES, DRS_ZONES, SECTOR_SPLITS, TRACK_LENGTH_M, isInDrsZone } from "./circuit";
import type { TelemetrySample, TrapSpeeds } from "./types";

const V_TOP = 92; // m/s ≈ 331 kph
const V_MIN = 17; // slowest hairpin
const A_LAT = 34; // m/s² lateral grip
const A_BRAKE = 42; // m/s² braking

/** [kphLow, kphHigh, rpmLow, rpmHigh] per gear — RPM climbs through the band
 *  the same way a real car's does between upshifts. */
const GEAR_BANDS: [number, number, number, number][] = [
  [0, 55, 6500, 12800],
  [55, 95, 8200, 13100],
  [95, 128, 8600, 13200],
  [128, 160, 8900, 13200],
  [160, 195, 9200, 13300],
  [195, 232, 9500, 13300],
  [232, 275, 9800, 13300],
  [275, 999, 10200, 13400],
];

function gearAndRpm(kph: number): { gear: number; rpm: number } {
  let idx = GEAR_BANDS.findIndex(([lo, hi]) => kph >= lo && kph < hi);
  if (idx < 0) idx = GEAR_BANDS.length - 1;
  const [lo, hi, rpmLo, rpmHi] = GEAR_BANDS[idx];
  const frac = Math.max(0, Math.min(1, (kph - lo) / (hi - lo || 1)));
  return { gear: idx + 1, rpm: Math.round(rpmLo + frac * (rpmHi - rpmLo)) };
}

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

/** paceOffset: seconds/lap slower than reference — shaves grip + top speed. */
export function telemetryLap(driverKey: number, lap: number, paceOffset: number): TelemetrySample[] {
  const rng = mulberry32(driverKey * 7919 + lap * 104729 + 13);
  const n = CIRCUIT_SAMPLES.length;
  const ds = TRACK_LENGTH_M / n;
  const handicap = 1 - Math.min(paceOffset, 1.2) * 0.006;
  const vTop = V_TOP * handicap;
  const aLat = A_LAT * handicap;

  // smooth per-corner noise: a few low-frequency sine wobbles per lap
  const ph1 = rng() * Math.PI * 2;
  const ph2 = rng() * Math.PI * 2;
  const ph3 = rng() * Math.PI * 2;
  const wobble = (i: number) => {
    const x = (i / n) * Math.PI * 2;
    return 1 + 0.006 * Math.sin(5 * x + ph1) + 0.005 * Math.sin(9 * x + ph2) + 0.004 * Math.sin(17 * x + ph3);
  };

  const vLim = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.max(CIRCUIT_SAMPLES[i].curvature, 1e-5);
    const corner = Math.min(vTop, Math.max(V_MIN, Math.sqrt(aLat / k)));
    // full wobble where the corner limit actually binds — noise on the
    // straight-line cap at full strength makes throttle chatter between
    // 100% and partial; a heavily damped wobble still breaks the "every
    // flat-out straight reads as the exact same trap speed" artifact
    // without reintroducing that chatter
    vLim[i] = corner < vTop - 0.5 ? corner * wobble(i) : vTop * (1 + (wobble(i) - 1) * 0.2);
  }

  const v = Float64Array.from(vLim);
  // two wrapped passes settle the cyclic profile
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i <= n; i++) {
      const j = i % n;
      const p = (i - 1) % n;
      const aAcc = 3 + 12 * (1 - v[p] / vTop); // traction-limited low, drag-limited high
      v[j] = Math.min(v[j], Math.sqrt(v[p] * v[p] + 2 * aAcc * ds));
    }
    for (let i = n - 1; i >= -1; i--) {
      const j = (i + n) % n;
      const q = (i + 1 + n) % n;
      v[j] = Math.min(v[j], Math.sqrt(v[q] * v[q] + 2 * A_BRAKE * ds));
    }
  }

  // light smoothing pass so pedal traces derive from a clean profile
  const vs = new Float64Array(n);
  for (let i = 0; i < n; i++) vs[i] = (v[(i - 1 + n) % n] + v[i] + v[(i + 1) % n]) / 3;

  const throttleRaw = new Float64Array(n);
  const brakeRaw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (vs[(i + 1) % n] ** 2 - vs[i] ** 2) / (2 * ds);
    if (a > 0.6) {
      throttleRaw[i] = Math.min(100, 55 + (a / 12) * 60);
    } else if (a < -1.5) {
      brakeRaw[i] = Math.min(100, (-a / A_BRAKE) * 130);
    } else {
      // flat-out on a straight, maintenance throttle through a balanced corner
      throttleRaw[i] = vs[i] > vTop * 0.985 ? 100 : 30 + (vs[i] / vTop) * 40;
    }
  }

  const out: TelemetrySample[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let throttle = 0;
    let brake = 0;
    for (let k = -2; k <= 2; k++) {
      throttle += throttleRaw[(i + k + n) % n];
      brake += brakeRaw[(i + k + n) % n];
    }
    throttle /= 5;
    brake /= 5;
    const kph = vs[i] * 3.6;
    const { gear, rpm } = gearAndRpm(kph);
    // DRS is only open flat-out inside a zone — lifting or braking closes it
    // immediately, same as the real system
    const drsOpen = throttle >= 97 && brake < 1 && isInDrsZone(i / n);
    out[i] = {
      dist: Math.round(i * ds),
      speedKph: Math.round(kph * 10) / 10,
      throttlePct: Math.round(throttle),
      brakePct: Math.round(brake),
      gear,
      rpm,
      drsOpen,
    };
  }
  return out;
}

/** Fraction to sample for the "finish straight" trap — 85% through whichever
 *  DRS zone sits on the approach to the line, not a fixed guess. A fixed
 *  fraction risks landing past the braking point for turn 1 depending on
 *  how long the final corner's braking zone is, which reads as a LOWER trap
 *  speed than the earlier intermediates — backwards for what should
 *  usually be the fastest point on the lap. */
const FINISH_STRAIGHT_FRAC: number = (() => {
  if (!DRS_ZONES.length) return 0.98;
  let best = DRS_ZONES[0];
  let bestScore = -Infinity;
  for (const z of DRS_ZONES) {
    const [s, e] = z;
    const score = e < s ? 2 : e; // a zone that wraps past the line always wins; else prefer the one ending closest to it
    if (score > bestScore) {
      bestScore = score;
      best = z;
    }
  }
  const [s, e] = best;
  const span = e >= s ? e - s : e + 1 - s;
  return (s + span * 0.85) % 1;
})();

/** Speed-trap readings (I1 / I2 / finish-straight) for one lap — samples the
 *  same synthesised lap at the sector-split points and deep into the final
 *  DRS straight. */
export function trapSpeeds(driverKey: number, lap: number, paceOffset: number): TrapSpeeds {
  const samples = telemetryLap(driverKey, lap, paceOffset);
  const n = samples.length;
  const at = (frac: number) => samples[Math.min(n - 1, Math.floor(((frac % 1) + 1) % 1 * n))].speedKph;
  return {
    i1Kph: at(SECTOR_SPLITS[0]),
    i2Kph: at(SECTOR_SPLITS[1]),
    stKph: at(FINISH_STRAIGHT_FRAC),
  };
}

/** Splits one lap's telemetry into `buckets` equal-distance minisectors and
 *  returns the time spent in each — the same construction F1TV's purple/green
 *  microsector strip uses, just computed from synthesised speed rather than
 *  transponder loops. */
export function minisectorTimes(driverKey: number, lap: number, paceOffset: number, buckets: number): number[] {
  const samples = telemetryLap(driverKey, lap, paceOffset);
  const n = samples.length;
  const ds = TRACK_LENGTH_M / n;
  const out = new Array<number>(buckets).fill(0);
  for (const s of samples) {
    const bucket = Math.min(buckets - 1, Math.floor((s.dist / TRACK_LENGTH_M) * buckets));
    const speedMs = s.speedKph / 3.6;
    out[bucket] += ds / Math.max(speedMs, 1);
  }
  return out;
}
