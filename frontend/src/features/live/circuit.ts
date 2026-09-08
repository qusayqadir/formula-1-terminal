/** Real circuit geometry for the simulated live feed, loaded from GeoJSON —
 * see src/assets/circuits/circuit-geojson/. The source LineString (lon/lat,
 * GPS-surveyed) is projected to local metres (equirectangular, longitude
 * scaled by cos(latitude) — the area is under a kilometre wide, so this is
 * accurate to well under a metre of error), lightly Chaikin-smoothed to
 * even out survey noise, then resampled to UNIFORM arc length so a lap
 * fraction maps to a point with a cheap index lookup. Per-sample curvature
 * (radians of heading change per metre) drives the telemetry speed profile
 * and the map's speed-heatmap coloring.
 *
 * To add another circuit: drop its GeoJSON next to bh-2002.geojson, point
 * CIRCUIT_GEOJSON at it, done — nothing else in this file is per-circuit.
 */
import circuitGeoJsonRaw from "@/assets/circuits/circuit-geojson/bh-2002.geojson?raw";

export interface CircuitSample {
  x: number;
  y: number;
  /** curvature in rad/m at this sample (moving-average smoothed) */
  curvature: number;
}

interface CircuitGeoJson {
  features: { properties: { Name?: string; Location?: string }; geometry: { coordinates: [number, number][] } }[];
}

const CIRCUIT_GEOJSON = JSON.parse(circuitGeoJsonRaw) as CircuitGeoJson;
const RAW_LONLAT = CIRCUIT_GEOJSON.features[0].geometry.coordinates;
export const CIRCUIT_REAL_NAME: string = CIRCUIT_GEOJSON.features[0].properties.Name ?? "Circuit";

export const TOTAL_LAPS = 57;

/** Lap-fraction where S1 ends / S2 ends (S3 runs to the line) — the source
 *  GeoJSON is a bare centreline with no marked sector boundaries, so these
 *  stay reasonable approximations rather than surveyed values. */
export const SECTOR_SPLITS: [number, number] = [0.32, 0.66];

/** Share of a lap's TIME spent in each sector (S2 is the technical one). */
export const SECTOR_TIME_WEIGHTS: [number, number, number] = [0.3, 0.37, 0.33];

export const METERS_PER_LAT_DEG = 111320;

/** Projection origin (mean lon/lat of the surveyed loop) and the local
 *  lon-degree scale at that latitude — shared by the forward projection
 *  (lon/lat -> local metres, used for curvature/heatmap/telemetry math) and
 *  the inverse used to place a real basemap under the track: any local
 *  (dx, dy) offset can be converted back to lat/lng via `localOffsetToLatLng`
 *  without re-deriving the origin. */
const PROJECTION_ORIGIN = (() => {
  const pts = RAW_LONLAT[0][0] === RAW_LONLAT[RAW_LONLAT.length - 1][0] &&
    RAW_LONLAT[0][1] === RAW_LONLAT[RAW_LONLAT.length - 1][1]
    ? RAW_LONLAT.slice(0, -1)
    : RAW_LONLAT;
  const lat0 = pts.reduce((s, [, lat]) => s + lat, 0) / pts.length;
  const lon0 = pts.reduce((s, [lon]) => s + lon, 0) / pts.length;
  return { lat0, lon0, metersPerLonDeg: METERS_PER_LAT_DEG * Math.cos((lat0 * Math.PI) / 180) };
})();

/** Inverse of the local equirectangular projection — turns a small (dx, dy)
 *  metre offset from a real lat/lng anchor back into lat/lng, so decorative
 *  geometry computed in local space (sector ticks, corner-label pushes) can
 *  be placed on the real Google Maps basemap. Accurate to well under a
 *  metre over the scale of a single circuit, same as the forward pass. */
export function localOffsetToLatLng(anchor: { lat: number; lng: number }, dx: number, dy: number): { lat: number; lng: number } {
  return { lat: anchor.lat - dy / METERS_PER_LAT_DEG, lng: anchor.lng + dx / PROJECTION_ORIGIN.metersPerLonDeg };
}

function chaikin(points: [number, number][], iterations: number): [number, number][] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % pts.length];
      next.push([0.75 * px + 0.25 * qx, 0.75 * py + 0.25 * qy]);
      next.push([0.25 * px + 0.75 * qx, 0.25 * py + 0.75 * qy]);
    }
    pts = next;
  }
  return pts;
}

/** lon/lat → local metres, flipping Y so north stays "up" in SVG space
 *  (screen Y grows downward, latitude grows northward). */
function dedupClosingPoint(coords: [number, number][]): [number, number][] {
  return coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]
    ? coords.slice(0, -1)
    : coords;
}

function projectLonLat(coords: [number, number][]): [number, number][] {
  const pts = dedupClosingPoint(coords);
  const { lat0, lon0, metersPerLonDeg } = PROJECTION_ORIGIN;
  return pts.map(([lon, lat]) => [(lon - lon0) * metersPerLonDeg, -(lat - lat0) * METERS_PER_LAT_DEG]);
}

function buildSamples(): {
  samples: CircuitSample[];
  pathD: string;
  trackLengthM: number;
  viewBox: string;
  centroid: { x: number; y: number };
  lonLat: { lat: number; lng: number }[];
} {
  const projected = projectLonLat(RAW_LONLAT);
  // one light pass: enough to smooth GPS-survey jitter without rounding off
  // real corner shape (unlike the old hand-drawn control polygon, which
  // needed heavy smoothing just to look like a track at all)
  const smooth = chaikin(projected, 0);
  // chaikin(pts, 0) is a no-op, so `smooth` is index-aligned 1:1 with the
  // deduped source lon/lat loop — the resample loop below can reuse the same
  // seg/t against this array to get a real lat/lng for every local (x, y)
  // sample, with zero extra geometry work.
  const lonLatSource = dedupClosingPoint(RAW_LONLAT);

  // cumulative arc length of the smoothed loop
  const cum: number[] = [0];
  for (let i = 1; i <= smooth.length; i++) {
    const [ax, ay] = smooth[i - 1];
    const [bx, by] = smooth[i % smooth.length];
    cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  const trackLengthM = cum[cum.length - 1];

  // uniform resample
  const N = 720;
  const raw: { x: number; y: number }[] = [];
  const lonLat: { lat: number; lng: number }[] = [];
  let seg = 0;
  for (let i = 0; i < N; i++) {
    const target = (i / N) * trackLengthM;
    while (seg < smooth.length - 1 && cum[seg + 1] < target) seg++;
    const [ax, ay] = smooth[seg];
    const [bx, by] = smooth[(seg + 1) % smooth.length];
    const span = cum[seg + 1] - cum[seg] || 1;
    const t = (target - cum[seg]) / span;
    raw.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
    const [lonA, latA] = lonLatSource[seg];
    const [lonB, latB] = lonLatSource[(seg + 1) % lonLatSource.length];
    lonLat.push({ lat: latA + (latB - latA) * t, lng: lonA + (lonB - lonA) * t });
  }

  const ds = trackLengthM / N; // metres between uniform samples
  const heading: number[] = raw.map((p, i) => {
    const q = raw[(i + 1) % N];
    return Math.atan2(q.y - p.y, q.x - p.x);
  });
  const turn: number[] = heading.map((h, i) => {
    let d = heading[(i + 1) % N] - h;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) / ds;
  });
  // moving average keeps the telemetry speed profile from jittering on
  // Chaikin's piecewise-linear corners
  const W = 7;
  const samples: CircuitSample[] = raw.map((p, i) => {
    let sum = 0;
    for (let k = -W; k <= W; k++) sum += turn[(i + k + N) % N];
    return { x: p.x, y: p.y, curvature: sum / (2 * W + 1) };
  });

  const pathD =
    samples.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("") + "Z";

  const xs = samples.map((s) => s.x);
  const ys = samples.map((s) => s.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = Math.max(maxX - minX, maxY - minY) * 0.08 + 20;
  const viewBox = `${(minX - pad).toFixed(0)} ${(minY - pad).toFixed(0)} ${(maxX - minX + 2 * pad).toFixed(0)} ${(maxY - minY + 2 * pad).toFixed(0)}`;
  const centroid = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

  return { samples, pathD, trackLengthM, viewBox, centroid, lonLat: lonLat };
}

const built = buildSamples();

export const CIRCUIT_SAMPLES: CircuitSample[] = built.samples;
export const CIRCUIT_PATH_D: string = built.pathD;
/** Real arc length of the surveyed centreline — not a hardcoded per-circuit
 *  number, so swapping in a different GeoJSON just works. */
export const TRACK_LENGTH_M: number = built.trackLengthM;
export const CIRCUIT_VIEWBOX: string = built.viewBox;
/** Bounding-box centre — used to push sector/corner labels outward from the
 *  track rather than off a hardcoded canvas centre. */
export const CIRCUIT_CENTROID: { x: number; y: number } = built.centroid;

/** Real lat/lng per sample, index-aligned 1:1 with CIRCUIT_SAMPLES — lets a
 *  real Google Maps basemap sit under the same geometry used for the local
 *  SVG-space curvature/heatmap/telemetry math. */
export const CIRCUIT_LONLAT: { lat: number; lng: number }[] = built.lonLat;

/** Mean lat/lng of the loop — map center before fitBounds corrects the zoom. */
export const CIRCUIT_CENTER_LATLNG: { lat: number; lng: number } = {
  lat: PROJECTION_ORIGIN.lat0,
  lng: PROJECTION_ORIGIN.lon0,
};

/** Real-world lat/lng bounds of the loop, for `map.fitBounds()`. */
export const CIRCUIT_LATLNG_BOUNDS: { north: number; south: number; east: number; west: number } = (() => {
  const lats = CIRCUIT_LONLAT.map((p) => p.lat);
  const lngs = CIRCUIT_LONLAT.map((p) => p.lng);
  return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) };
})();

/** Lap fraction (0..1) → real lat/lng on the centreline — the basemap
 *  equivalent of `circuitPointAt`, same interpolation over the index-aligned
 *  CIRCUIT_LONLAT array. */
export function circuitLonLatAt(frac: number): { lat: number; lng: number } {
  const n = CIRCUIT_LONLAT.length;
  const f = ((frac % 1) + 1) % 1;
  const pos = f * n;
  const i = Math.floor(pos) % n;
  const t = pos - Math.floor(pos);
  const a = CIRCUIT_LONLAT[i];
  const b = CIRCUIT_LONLAT[(i + 1) % n];
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Lap fraction (0..1) → point on the centreline. */
export function circuitPointAt(frac: number): { x: number; y: number } {
  const n = CIRCUIT_SAMPLES.length;
  const f = ((frac % 1) + 1) % 1;
  const pos = f * n;
  const i = Math.floor(pos) % n;
  const t = pos - Math.floor(pos);
  const a = CIRCUIT_SAMPLES[i];
  const b = CIRCUIT_SAMPLES[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/* ------------------------------------------------------------------ *
 * Reference speed profile — the same cornering-speed physics telemetry.ts
 * applies per-driver, run once at handicap=1 with no per-driver noise.
 * Feeds the track map's speed-heatmap coloring so the circuit itself reads
 * as fast/slow before any car moves.
 * ------------------------------------------------------------------ */

const REF_V_TOP = 92;
const REF_V_MIN = 17;
const REF_A_LAT = 34;
const REF_A_BRAKE = 42;

function buildReferenceSpeed(): Float64Array {
  const n = CIRCUIT_SAMPLES.length;
  const ds = TRACK_LENGTH_M / n;
  const vLim = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.max(CIRCUIT_SAMPLES[i].curvature, 1e-5);
    vLim[i] = Math.min(REF_V_TOP, Math.max(REF_V_MIN, Math.sqrt(REF_A_LAT / k)));
  }
  const v = Float64Array.from(vLim);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i <= n; i++) {
      const j = i % n;
      const p = (i - 1) % n;
      const aAcc = 3 + 12 * (1 - v[p] / REF_V_TOP);
      v[j] = Math.min(v[j], Math.sqrt(v[p] * v[p] + 2 * aAcc * ds));
    }
    for (let i = n - 1; i >= -1; i--) {
      const j = (i + n) % n;
      const q = (i + 1 + n) % n;
      v[j] = Math.min(v[j], Math.sqrt(v[q] * v[q] + 2 * REF_A_BRAKE * ds));
    }
  }
  return v;
}

/** m/s at each sample, reference (no-traffic) pace. Index-aligned with CIRCUIT_SAMPLES. */
export const REFERENCE_SPEED_MS: Float64Array = buildReferenceSpeed();
export const REFERENCE_SPEED_MAX = Math.max(...REFERENCE_SPEED_MS);
export const REFERENCE_SPEED_MIN = Math.min(...REFERENCE_SPEED_MS);

/* ------------------------------------------------------------------ *
 * Corner apex markers — local curvature maxima, merged when within 80 m
 * of each other, numbered in track order starting just after the line.
 * ------------------------------------------------------------------ */

export interface Corner {
  number: number;
  frac: number;
  point: { x: number; y: number };
}

function buildCorners(): Corner[] {
  const n = CIRCUIT_SAMPLES.length;
  const ds = TRACK_LENGTH_M / n;
  const threshold = 0.0035;
  const mergeSamples = Math.round(80 / ds);
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = CIRCUIT_SAMPLES[i].curvature;
    if (c < threshold) continue;
    const prev = CIRCUIT_SAMPLES[(i - 1 + n) % n].curvature;
    const next = CIRCUIT_SAMPLES[(i + 1) % n].curvature;
    if (c >= prev && c >= next) peaks.push(i);
  }
  const merged: number[] = [];
  for (const i of peaks) {
    const last = merged[merged.length - 1];
    if (last != null && Math.min(Math.abs(i - last), n - Math.abs(i - last)) <= mergeSamples) continue;
    merged.push(i);
  }
  return merged.map((idx, k) => {
    const s = CIRCUIT_SAMPLES[idx];
    return { number: k + 1, frac: idx / n, point: { x: s.x, y: s.y } };
  });
}

export const CORNERS: Corner[] = buildCorners();

/* ------------------------------------------------------------------ *
 * DRS zones — the two longest low-curvature runs, trimmed for a
 * realistic detection point (activates ~60 m into the straight) and
 * closing point (~40 m before the following braking zone).
 * ------------------------------------------------------------------ */

function buildDrsZones(): [number, number][] {
  const n = CIRCUIT_SAMPLES.length;
  const ds = TRACK_LENGTH_M / n;
  const straight = CIRCUIT_SAMPLES.map((s) => s.curvature < 0.0022);
  const minRunSamples = Math.round(350 / ds);
  const trimSamples = Math.round(50 / ds);

  const runs: [number, number][] = [];
  let i = 0;
  while (i < n) {
    if (!straight[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && straight[j]) j++;
    runs.push([i, j - 1]);
    i = j;
  }
  // merge a run that wraps across index 0
  if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === n - 1) {
    const first = runs.shift()!;
    const last = runs.pop()!;
    runs.push([last[0], first[1] + n]);
  }

  const sized = runs
    .map(([s, e]) => ({ s, e, len: e - s + 1 }))
    .filter((r) => r.len > minRunSamples)
    .sort((a, b) => b.len - a.len)
    .slice(0, 2);

  return sized.map(({ s, e }) => {
    const start = ((s + trimSamples) % n) / n;
    const end = ((e - trimSamples + n) % n) / n;
    return [start, end] as [number, number];
  });
}

/** Fractional [start,end] ranges (each may wrap past 1.0) where DRS is open. */
export const DRS_ZONES: [number, number][] = buildDrsZones();

export function isInDrsZone(frac: number): boolean {
  const f = ((frac % 1) + 1) % 1;
  return DRS_ZONES.some(([s, e]) => (e >= s ? f >= s && f <= e : f >= s || f <= e % 1));
}
