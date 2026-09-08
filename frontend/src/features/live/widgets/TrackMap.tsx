import { useMemo, useState } from "react";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { Segmented } from "@/components/ui/controls";
import { useChartTheme } from "@/components/charts/theme";
import { CircuitMap, type CircuitMapLabel } from "@/components/maps/CircuitMap";
import {
  CIRCUIT_CENTROID,
  CIRCUIT_LATLNG_BOUNDS,
  CIRCUIT_LONLAT,
  CORNERS,
  DRS_ZONES,
  SECTOR_SPLITS,
  circuitLonLatAt,
  circuitPointAt,
  localOffsetToLatLng,
} from "../circuit";
import { compareColor } from "../compareColors";
import type { LiveSnapshot } from "../types";

/** Live track position on a real dark Google Maps basemap — the same "real
 *  map + track line" look GitHub uses to preview an f1-circuits GeoJSON, but
 *  terminal-dark and with live cars. The centreline, DRS zones, corners and
 *  sector ticks are all projected from the same GeoJSON survey the telemetry
 *  math uses (circuit.ts); the road itself is a reference-speed heatmap so
 *  fast/slow sections read before any car moves. Cars are markers at their
 *  real lat/lng (via lap fraction); the two compared cars get an enlarged
 *  marker, a code pill and a short fading trail. Requires
 *  VITE_GOOGLE_MAPS_API_KEY (loaded once by the app-root APIProvider). */

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

type LatLng = [number, number];
const ll = (p: { lat: number; lng: number }): LatLng => [p.lat, p.lng];

/** Cross-track tick at a lap fraction, in real lat/lng — build the
 *  perpendicular in local metres then convert both ends back to lat/lng. */
function crossTick(frac: number, halfM: number): LatLng[] {
  const p = circuitPointAt(frac);
  const q = circuitPointAt(frac + 0.003);
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const anchor = circuitLonLatAt(frac);
  return [ll(localOffsetToLatLng(anchor, -nx * halfM, -ny * halfM)), ll(localOffsetToLatLng(anchor, nx * halfM, ny * halfM))];
}

/** Point pushed outward from the circuit centroid at a lap fraction (metres),
 *  in real lat/lng — where a corner/sector label clears the track. */
function labelAt(frac: number, pushM: number): { lat: number; lng: number } {
  const p = circuitPointAt(frac);
  const dx = p.x - CIRCUIT_CENTROID.x;
  const dy = p.y - CIRCUIT_CENTROID.y;
  const len = Math.hypot(dx, dy) || 1;
  return localOffsetToLatLng(circuitLonLatAt(frac), (dx / len) * pushM, (dy / len) * pushM);
}

/** The whole circuit is drawn as one solid light-blue line (no speed
 *  heatmap) — a single clean stroke reads far crisper than the overlapping
 *  gradient segments, which looked blurry/glowy on the basemap. */
const TRACK_BLUE = "#5CB8FF";

const OUTLINE: LatLng[] = CIRCUIT_LONLAT.map(ll);

const DRS_GEO: LatLng[][] = DRS_ZONES.map(([start, end]) => {
  const span = end >= start ? end - start : end + 1 - start;
  const steps = Math.max(6, Math.round(span * 200));
  const pts: LatLng[] = [];
  for (let i = 0; i <= steps; i++) pts.push(ll(circuitLonLatAt(start + (span * i) / steps)));
  return pts;
});

const TICKS = [
  { path: crossTick(0, 55), strong: true }, // start/finish
  { path: crossTick(SECTOR_SPLITS[0], 42) },
  { path: crossTick(SECTOR_SPLITS[1], 42) },
];

const FIT = {
  bounds: {
    north: CIRCUIT_LATLNG_BOUNDS.north,
    south: CIRCUIT_LATLNG_BOUNDS.south,
    east: CIRCUIT_LATLNG_BOUNDS.east,
    west: CIRCUIT_LATLNG_BOUNDS.west,
  },
};

const TRAIL_STEPS = 6;
const TRAIL_SPACING = 0.0032;

export function TrackMap(props: {
  snapshot: LiveSnapshot;
  selectedIds: [number | null, number | null];
  className?: string;
}) {
  const { snapshot, selectedIds } = props;
  const { t } = useChartTheme();
  const [basemap, setBasemap] = useState<"roadmap" | "hybrid">("hybrid");

  const driverA = snapshot.drivers.find((d) => d.id === selectedIds[0]);
  const driverB = snapshot.drivers.find((d) => d.id === selectedIds[1]);
  const onTrack = snapshot.drivers.filter((d) => d.status !== "RETIRED");

  const labels = useMemo<CircuitMapLabel[]>(() => {
    const out: CircuitMapLabel[] = [];
    for (const d of DRS_GEO) {
      const mid = d[Math.floor(d.length / 2)];
      out.push({ lat: mid[0], lng: mid[1], text: "DRS", color: t.accent, size: 9 });
    }
    for (const c of CORNERS) {
      const p = labelAt(c.frac, 34);
      out.push({ lat: p.lat, lng: p.lng, text: String(c.number), color: t.labelDim, size: 8, weight: 500 });
    }
    const sf = labelAt(0.006, 26);
    const s1 = labelAt(SECTOR_SPLITS[0] / 2, 70);
    const s2 = labelAt((SECTOR_SPLITS[0] + SECTOR_SPLITS[1]) / 2, 70);
    const s3 = labelAt((SECTOR_SPLITS[1] + 1) / 2, 70);
    out.push({ lat: sf.lat, lng: sf.lng, text: "S/F", color: t.inkSub, size: 10 });
    out.push({ lat: s1.lat, lng: s1.lng, text: "S1", color: t.inkMut, size: 10 });
    out.push({ lat: s2.lat, lng: s2.lng, text: "S2", color: t.inkMut, size: 10 });
    out.push({ lat: s3.lat, lng: s3.lng, text: "S3", color: t.inkMut, size: 10 });
    return out;
  }, [t]);

  const cars = useMemo(
    () =>
      onTrack.map((d) => {
        const pos = circuitLonLatAt(d.trackFrac);
        const selected = selectedIds.includes(d.id);
        const color = d.id === driverB?.id && driverA ? compareColor("b", driverA, driverB) : d.color;
        return { id: d.id, code: d.code, color, lat: pos.lat, lng: pos.lng, selected };
      }),
    [onTrack, selectedIds, driverA, driverB],
  );

  const trails = useMemo(() => {
    const out: { color: string; points: LatLng[] }[] = [];
    for (const d of onTrack) {
      if (!selectedIds.includes(d.id)) continue;
      const color = d.id === driverB?.id && driverA ? compareColor("b", driverA, driverB) : d.color;
      const points: LatLng[] = [];
      for (let k = 1; k <= TRAIL_STEPS; k++) points.push(ll(circuitLonLatAt(d.trackFrac - k * TRAIL_SPACING)));
      out.push({ color, points });
    }
    return out;
  }, [onTrack, selectedIds, driverA, driverB]);

  return (
    <AnalyticsCard
      eyebrow="Live · Track"
      title="Track position"
      subtitle={`${snapshot.circuitName} · ${onTrack.length} cars on track`}
      controls={
        <Segmented
          ariaLabel="Basemap"
          value={basemap}
          onChange={setBasemap}
          options={[
            { value: "roadmap", label: "MAP" },
            { value: "hybrid", label: "SAT" },
          ]}
        />
      }
      error={!API_KEY ? new Error("Set VITE_GOOGLE_MAPS_API_KEY to enable this map") : null}
      expandable
      className={props.className}
      bodyClassName="p-0"
    >
      {API_KEY && (
      <CircuitMap
        outline={OUTLINE}
        outlineColor={TRACK_BLUE}
        outlineWeight={4}
        drs={DRS_GEO}
        ticks={TICKS}
        labels={labels}
        cars={cars}
        trails={trails}
        basemap={basemap}
        fit={FIT}
        fitKey={snapshot.circuitName}
        maxZoom={17}
      />
      )}
    </AnalyticsCard>
  );
}
