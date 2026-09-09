/** Real circuit geometry for the simulated live feed, loaded from GeoJSON —
 * see src/assets/circuits/circuit-geojson/ (the bacinger/f1-circuits survey
 * set, one LineString per circuit). Each source LineString (lon/lat,
 * GPS-surveyed) is projected to local metres (equirectangular, longitude
 * scaled by cos(latitude) — the area is under a kilometre wide, so this is
 * accurate to well under a metre of error), lightly Chaikin-smoothed to
 * even out survey noise, then resampled to UNIFORM arc length so a lap
 * fraction maps to a point with a cheap index lookup. Per-sample curvature
 * (radians of heading change per metre) drives the telemetry speed profile
 * and the map's speed-heatmap coloring.
 *
 * Every circuit in the folder is registered, keyed by its GeoJSON `Name` /
 * `Location` / `id`, and built lazily on first use (`resolveCircuitGeometry`).
 * That lets the live track map render whatever circuit the feed reports —
 * and gracefully fall back to a bare Google basemap when a brand-new venue
 * has no survey yet. The Baku City Circuit stays the module-level default so
 * the simulation physics in engine.ts / telemetry.ts resolve a concrete
 * default circuit; swapping the default id below repoints the whole sim.
 */

export interface CircuitSample {
  x: number;
  y: number;
  /** curvature in rad/m at this sample (moving-average smoothed) */
  curvature: number;
}

export interface Corner {
  number: number;
  frac: number;
  point: { x: number; y: number };
}

interface CircuitGeoJson {
  features: {
    properties: { id?: string; Name?: string; Location?: string };
    geometry: { coordinates: [number, number][] };
  }[];
}

/** Everything a consumer needs to draw + animate one circuit, in both local
 *  SVG-metre space (curvature/heatmap/telemetry math) and real lat/lng (the
 *  Google Maps basemap). Produced by `buildCircuit` and cached per id. */
export interface CircuitGeometry {
  id: string;
  name: string;
  location: string;
  samples: CircuitSample[];
  pathD: string;
  trackLengthM: number;
  viewBox: string;
  centroid: { x: number; y: number };
  lonLat: { lat: number; lng: number }[];
  center: { lat: number; lng: number };
  bounds: { north: number; south: number; east: number; west: number };
  corners: Corner[];
  drsZones: [number, number][];
  sectorSplits: [number, number];
  referenceSpeed: Float64Array;
  referenceSpeedMax: number;
  referenceSpeedMin: number;
  pointAt(frac: number): { x: number; y: number };
  lonLatAt(frac: number): { lat: number; lng: number };
  localOffsetToLatLng(anchor: { lat: number; lng: number }, dx: number, dy: number): { lat: number; lng: number };
  isInDrsZone(frac: number): boolean;
}

export const TOTAL_LAPS = 51;

/** Lap-fraction where S1 ends / S2 ends (S3 runs to the line) — the source
 *  GeoJSON is a bare centreline with no marked sector boundaries, so these
 *  stay reasonable approximations rather than surveyed values, shared by
 *  every circuit. */
export const SECTOR_SPLITS: [number, number] = [0.32, 0.66];

/** Share of a lap's TIME spent in each sector (S2 is the technical one). */
export const SECTOR_TIME_WEIGHTS: [number, number, number] = [0.3, 0.37, 0.33];

export const METERS_PER_LAT_DEG = 111320;

/* ------------------------------------------------------------------ *
 * Pure geometry helpers (no per-circuit state).
 * ------------------------------------------------------------------ */

function dedupClosingPoint(coords: [number, number][]): [number, number][] {
  return coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]
    ? coords.slice(0, -1)
    : coords;
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

/* ------------------------------------------------------------------ *
 * Per-circuit builder — turns one GeoJSON LineString into a fully
 * derived CircuitGeometry. Everything below is scoped to the passed
 * circuit; nothing here is a module singleton.
 * ------------------------------------------------------------------ */

const REF_V_TOP = 92;
const REF_V_MIN = 17;
const REF_A_LAT = 34;
const REF_A_BRAKE = 42;

export function buildCircuit(raw: CircuitGeoJson): CircuitGeometry {
  const props = raw.features[0].properties;
  const rawLonLat = raw.features[0].geometry.coordinates;
  const name = props.Name ?? "Circuit";
  const location = props.Location ?? "";
  const id = props.id ?? name;

  // projection origin (mean lon/lat of the surveyed loop) + local lon scale
  const deduped = dedupClosingPoint(rawLonLat);
  const lat0 = deduped.reduce((s, [, lat]) => s + lat, 0) / deduped.length;
  const lon0 = deduped.reduce((s, [lon]) => s + lon, 0) / deduped.length;
  const metersPerLonDeg = METERS_PER_LAT_DEG * Math.cos((lat0 * Math.PI) / 180);

  const localOffsetToLatLng = (anchor: { lat: number; lng: number }, dx: number, dy: number) => ({
    lat: anchor.lat - dy / METERS_PER_LAT_DEG,
    lng: anchor.lng + dx / metersPerLonDeg,
  });

  // lon/lat → local metres, flipping Y so north stays "up" in SVG space
  const projected: [number, number][] = deduped.map(([lon, lat]) => [
    (lon - lon0) * metersPerLonDeg,
    -(lat - lat0) * METERS_PER_LAT_DEG,
  ]);
  // chaikin(pts, 0) is a no-op, so `smooth` stays index-aligned 1:1 with the
  // deduped source loop — the resample can reuse the same seg/t to recover a
  // real lat/lng for every local (x, y) sample with zero extra geometry work.
  const smooth = chaikin(projected, 0);
  const lonLatSource = deduped;

  // cumulative arc length of the loop
  const cum: number[] = [0];
  for (let i = 1; i <= smooth.length; i++) {
    const [ax, ay] = smooth[i - 1];
    const [bx, by] = smooth[i % smooth.length];
    cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  const trackLengthM = cum[cum.length - 1];

  // uniform resample
  const N = 720;
  const rawPts: { x: number; y: number }[] = [];
  const lonLat: { lat: number; lng: number }[] = [];
  let seg = 0;
  for (let i = 0; i < N; i++) {
    const target = (i / N) * trackLengthM;
    while (seg < smooth.length - 1 && cum[seg + 1] < target) seg++;
    const [ax, ay] = smooth[seg];
    const [bx, by] = smooth[(seg + 1) % smooth.length];
    const span = cum[seg + 1] - cum[seg] || 1;
    const t = (target - cum[seg]) / span;
    rawPts.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
    const [lonA, latA] = lonLatSource[seg];
    const [lonB, latB] = lonLatSource[(seg + 1) % lonLatSource.length];
    lonLat.push({ lat: latA + (latB - latA) * t, lng: lonA + (lonB - lonA) * t });
  }

  const ds = trackLengthM / N; // metres between uniform samples
  const heading: number[] = rawPts.map((p, i) => {
    const q = rawPts[(i + 1) % N];
    return Math.atan2(q.y - p.y, q.x - p.x);
  });
  const turn: number[] = heading.map((h, i) => {
    let d = heading[(i + 1) % N] - h;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) / ds;
  });
  const W = 7;
  const samples: CircuitSample[] = rawPts.map((p, i) => {
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

  const lats = lonLat.map((p) => p.lat);
  const lngs = lonLat.map((p) => p.lng);
  const bounds = { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) };

  const pointAt = (frac: number) => {
    const n = samples.length;
    const f = ((frac % 1) + 1) % 1;
    const pos = f * n;
    const i = Math.floor(pos) % n;
    const t = pos - Math.floor(pos);
    const a = samples[i];
    const b = samples[(i + 1) % n];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const lonLatAt = (frac: number) => {
    const n = lonLat.length;
    const f = ((frac % 1) + 1) % 1;
    const pos = f * n;
    const i = Math.floor(pos) % n;
    const t = pos - Math.floor(pos);
    const a = lonLat[i];
    const b = lonLat[(i + 1) % n];
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  };

  // reference (no-traffic) cornering-speed profile
  const referenceSpeed = (() => {
    const n = samples.length;
    const vLim = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const k = Math.max(samples[i].curvature, 1e-5);
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
  })();
  let refMax = -Infinity;
  let refMin = Infinity;
  for (const v of referenceSpeed) {
    if (v > refMax) refMax = v;
    if (v < refMin) refMin = v;
  }

  // corner apex markers — local curvature maxima, merged within 80 m
  const corners = (() => {
    const n = samples.length;
    const threshold = 0.0035;
    const mergeSamples = Math.round(80 / ds);
    const peaks: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = samples[i].curvature;
      if (c < threshold) continue;
      const prev = samples[(i - 1 + n) % n].curvature;
      const next = samples[(i + 1) % n].curvature;
      if (c >= prev && c >= next) peaks.push(i);
    }
    const merged: number[] = [];
    for (const i of peaks) {
      const last = merged[merged.length - 1];
      if (last != null && Math.min(Math.abs(i - last), n - Math.abs(i - last)) <= mergeSamples) continue;
      merged.push(i);
    }
    return merged.map((idx, k) => ({ number: k + 1, frac: idx / n, point: { x: samples[idx].x, y: samples[idx].y } }));
  })();

  // DRS zones — the two longest low-curvature runs, trimmed for realistic
  // detection/closing points
  const drsZones = (() => {
    const n = samples.length;
    const straight = samples.map((s) => s.curvature < 0.0022);
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
  })();

  const isInDrsZone = (frac: number) => {
    const f = ((frac % 1) + 1) % 1;
    return drsZones.some(([s, e]) => (e >= s ? f >= s && f <= e : f >= s || f <= e % 1));
  };

  return {
    id,
    name,
    location,
    samples,
    pathD,
    trackLengthM,
    viewBox,
    centroid,
    lonLat,
    center: { lat: lat0, lng: lon0 },
    bounds,
    corners,
    drsZones,
    sectorSplits: SECTOR_SPLITS,
    referenceSpeed,
    referenceSpeedMax: refMax,
    referenceSpeedMin: refMin,
    pointAt,
    lonLatAt,
    localOffsetToLatLng,
    isInDrsZone,
  };
}

/* ------------------------------------------------------------------ *
 * Registry — every GeoJSON in the folder, indexed by name/location/id
 * and built lazily (parsing + resampling all 40 up front would be
 * wasted work; the live feed only ever needs one at a time).
 * ------------------------------------------------------------------ */

const RAW_GEOJSON = import.meta.glob("../../assets/circuits/circuit-geojson/*.geojson", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

interface IndexEntry {
  id: string;
  name: string;
  location: string;
  raw: string;
}

const INDEX: IndexEntry[] = Object.values(RAW_GEOJSON).map((raw) => {
  const props = (JSON.parse(raw) as CircuitGeoJson).features[0].properties;
  return { id: props.id ?? "", name: props.Name ?? "", location: props.Location ?? "", raw };
});

const geometryCache = new Map<string, CircuitGeometry>();

function buildEntry(entry: IndexEntry): CircuitGeometry {
  const cached = geometryCache.get(entry.id);
  if (cached) return cached;
  const geo = buildCircuit(JSON.parse(entry.raw) as CircuitGeoJson);
  geometryCache.set(entry.id, geo);
  return geo;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Resolve a circuit by whatever identity the feed carries — its circuit
 *  name and/or venue location. Matches (in priority order) an exact
 *  normalized name/location/id, then a containment match, so DB names like
 *  "Autodromo Nazionale di Monza" still find bacinger's "Autodromo Nazionale
 *  Monza". Returns null when nothing matches — the caller falls back to a
 *  bare basemap. */
export function resolveCircuitGeometry(identity: { name?: string | null; location?: string | null }): CircuitGeometry | null {
  const cands = [identity.name, identity.location].filter((s): s is string => !!s).map(norm).filter(Boolean);
  if (!cands.length) return null;

  // exact match first (name, location, then id)
  for (const e of INDEX) {
    const keys = [norm(e.name), norm(e.location), norm(e.id)];
    if (cands.some((c) => keys.includes(c))) return buildEntry(e);
  }
  // containment fallback, longest overlap wins to avoid loose collisions
  let best: { entry: IndexEntry; score: number } | null = null;
  for (const e of INDEX) {
    const keys = [norm(e.name), norm(e.location)].filter(Boolean);
    for (const c of cands) {
      for (const k of keys) {
        if (k.length >= 4 && (k.includes(c) || c.includes(k))) {
          const score = Math.min(k.length, c.length);
          if (!best || score > best.score) best = { entry: e, score };
        }
      }
    }
  }
  return best ? buildEntry(best.entry) : null;
}

/* ------------------------------------------------------------------ *
 * Default circuit (Baku City Circuit, Azerbaijan GP) — module-level
 * exports the simulation (engine.ts / telemetry.ts) consumes. Change the
 * id here to repoint the default live venue to any surveyed circuit.
 * ------------------------------------------------------------------ */

const DEFAULT_CIRCUIT: CircuitGeometry =
  buildEntry(INDEX.find((e) => e.id === "az-2016") ?? INDEX[0]);

export const CIRCUIT_REAL_NAME: string = DEFAULT_CIRCUIT.name;
export const CIRCUIT_SAMPLES: CircuitSample[] = DEFAULT_CIRCUIT.samples;
export const CIRCUIT_PATH_D: string = DEFAULT_CIRCUIT.pathD;
export const TRACK_LENGTH_M: number = DEFAULT_CIRCUIT.trackLengthM;
export const CIRCUIT_VIEWBOX: string = DEFAULT_CIRCUIT.viewBox;
export const CIRCUIT_CENTROID: { x: number; y: number } = DEFAULT_CIRCUIT.centroid;
export const CIRCUIT_LONLAT: { lat: number; lng: number }[] = DEFAULT_CIRCUIT.lonLat;
export const CIRCUIT_CENTER_LATLNG: { lat: number; lng: number } = DEFAULT_CIRCUIT.center;
export const CIRCUIT_LATLNG_BOUNDS: { north: number; south: number; east: number; west: number } =
  DEFAULT_CIRCUIT.bounds;
export const CORNERS: Corner[] = DEFAULT_CIRCUIT.corners;
export const DRS_ZONES: [number, number][] = DEFAULT_CIRCUIT.drsZones;
export const REFERENCE_SPEED_MS: Float64Array = DEFAULT_CIRCUIT.referenceSpeed;
export const REFERENCE_SPEED_MAX = DEFAULT_CIRCUIT.referenceSpeedMax;
export const REFERENCE_SPEED_MIN = DEFAULT_CIRCUIT.referenceSpeedMin;

export function circuitPointAt(frac: number): { x: number; y: number } {
  return DEFAULT_CIRCUIT.pointAt(frac);
}
export function circuitLonLatAt(frac: number): { lat: number; lng: number } {
  return DEFAULT_CIRCUIT.lonLatAt(frac);
}
export function localOffsetToLatLng(anchor: { lat: number; lng: number }, dx: number, dy: number): { lat: number; lng: number } {
  return DEFAULT_CIRCUIT.localOffsetToLatLng(anchor, dx, dy);
}
export function isInDrsZone(frac: number): boolean {
  return DEFAULT_CIRCUIT.isInDrsZone(frac);
}
