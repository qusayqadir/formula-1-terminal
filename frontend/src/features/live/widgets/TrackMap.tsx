import { useMemo, useState } from "react";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { Segmented } from "@/components/ui/controls";
import { useChartTheme } from "@/components/charts/theme";
import { CircuitMap, type CircuitMapLabel } from "@/components/maps/CircuitMap";
import { resolveCircuitGeometry, type CircuitGeometry } from "../circuit";
import { compareColor } from "../compareColors";
import type { LiveSnapshot } from "../types";

/** Live track position on a real dark Google Maps basemap — the same "real
 *  map + track line" look GitHub uses to preview an f1-circuits GeoJSON, but
 *  terminal-dark and with live cars. The circuit is resolved from the feed's
 *  reported circuit (name/venue) against the full f1-circuits survey set, so
 *  the map follows whatever race is live. When a venue has no survey yet the
 *  widget degrades gracefully to a bare basemap centred on the venue rather
 *  than drawing the wrong track. The centreline, DRS zones, corners and
 *  sector ticks are all projected from the resolved GeoJSON (circuit.ts); the
 *  road is drawn as one clean light-blue stroke. Cars are markers at their
 *  real lat/lng (via lap fraction); the two compared cars get an enlarged
 *  marker, a code pill and a short fading trail. Requires
 *  VITE_GOOGLE_MAPS_API_KEY (loaded once by the app-root APIProvider). */

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

type LatLng = [number, number];
const ll = (p: { lat: number; lng: number }): LatLng => [p.lat, p.lng];

/** The whole circuit is drawn as one solid light-blue line (no speed
 *  heatmap) — a single clean stroke reads far crisper than the overlapping
 *  gradient segments, which looked blurry/glowy on the basemap. */
const TRACK_BLUE = "#5CB8FF";

const TRAIL_STEPS = 6;
const TRAIL_SPACING = 0.0032;

/** Cross-track tick at a lap fraction, in real lat/lng — build the
 *  perpendicular in local metres then convert both ends back to lat/lng. */
function crossTick(geo: CircuitGeometry, frac: number, halfM: number): LatLng[] {
  const p = geo.pointAt(frac);
  const q = geo.pointAt(frac + 0.003);
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const anchor = geo.lonLatAt(frac);
  return [ll(geo.localOffsetToLatLng(anchor, -nx * halfM, -ny * halfM)), ll(geo.localOffsetToLatLng(anchor, nx * halfM, ny * halfM))];
}

/** Point pushed outward from the circuit centroid at a lap fraction (metres),
 *  in real lat/lng — where a corner/sector label clears the track. */
function labelAt(geo: CircuitGeometry, frac: number, pushM: number): { lat: number; lng: number } {
  const p = geo.pointAt(frac);
  const dx = p.x - geo.centroid.x;
  const dy = p.y - geo.centroid.y;
  const len = Math.hypot(dx, dy) || 1;
  return geo.localOffsetToLatLng(geo.lonLatAt(frac), (dx / len) * pushM, (dy / len) * pushM);
}

export function TrackMap(props: {
  snapshot: LiveSnapshot;
  selectedIds: [number | null, number | null];
  className?: string;
}) {
  const { snapshot, selectedIds } = props;
  const { t } = useChartTheme();
  const [basemap, setBasemap] = useState<"roadmap" | "hybrid">("hybrid");

  // Resolve the live circuit from the feed's reported identity. Null = no
  // survey for this venue yet → fall back to a bare basemap.
  const geo = useMemo(
    () => resolveCircuitGeometry({ name: snapshot.circuitName }),
    [snapshot.circuitName],
  );

  const driverA = snapshot.drivers.find((d) => d.id === selectedIds[0]);
  const driverB = snapshot.drivers.find((d) => d.id === selectedIds[1]);
  const onTrack = snapshot.drivers.filter((d) => d.status !== "RETIRED");

  // Static geometry (outline, DRS, ticks, labels, fit) — recomputed only when
  // the resolved circuit changes, not every telemetry tick.
  const track = useMemo(() => {
    if (!geo) return null;
    const [s1, s2] = geo.sectorSplits;
    const outline: LatLng[] = geo.lonLat.map(ll);
    const drs: LatLng[][] = geo.drsZones.map(([start, end]) => {
      const span = end >= start ? end - start : end + 1 - start;
      const steps = Math.max(6, Math.round(span * 200));
      const pts: LatLng[] = [];
      for (let i = 0; i <= steps; i++) pts.push(ll(geo.lonLatAt(start + (span * i) / steps)));
      return pts;
    });
    const ticks = [
      { path: crossTick(geo, 0, 55), strong: true }, // start/finish
      { path: crossTick(geo, s1, 42) },
      { path: crossTick(geo, s2, 42) },
    ];
    const labels: CircuitMapLabel[] = [];
    for (const d of drs) {
      const mid = d[Math.floor(d.length / 2)];
      labels.push({ lat: mid[0], lng: mid[1], text: "DRS", color: t.accent, size: 9 });
    }
    for (const c of geo.corners) {
      const p = labelAt(geo, c.frac, 34);
      labels.push({ lat: p.lat, lng: p.lng, text: String(c.number), color: t.labelDim, size: 8, weight: 500 });
    }
    const sf = labelAt(geo, 0.006, 26);
    const l1 = labelAt(geo, s1 / 2, 70);
    const l2 = labelAt(geo, (s1 + s2) / 2, 70);
    const l3 = labelAt(geo, (s2 + 1) / 2, 70);
    labels.push({ lat: sf.lat, lng: sf.lng, text: "S/F", color: t.inkSub, size: 10 });
    labels.push({ lat: l1.lat, lng: l1.lng, text: "S1", color: t.inkMut, size: 10 });
    labels.push({ lat: l2.lat, lng: l2.lng, text: "S2", color: t.inkMut, size: 10 });
    labels.push({ lat: l3.lat, lng: l3.lng, text: "S3", color: t.inkMut, size: 10 });
    return { outline, drs, ticks, labels, fit: { bounds: geo.bounds } };
  }, [geo, t]);

  const cars = useMemo(() => {
    if (!geo) return [];
    return onTrack.map((d) => {
      const pos = geo.lonLatAt(d.trackFrac);
      const selected = selectedIds.includes(d.id);
      const color = d.id === driverB?.id && driverA ? compareColor("b", driverA, driverB) : d.color;
      return { id: d.id, code: d.code, color, lat: pos.lat, lng: pos.lng, selected };
    });
  }, [geo, onTrack, selectedIds, driverA, driverB]);

  const trails = useMemo(() => {
    if (!geo) return [];
    const out: { color: string; points: LatLng[] }[] = [];
    for (const d of onTrack) {
      if (!selectedIds.includes(d.id)) continue;
      const color = d.id === driverB?.id && driverA ? compareColor("b", driverA, driverB) : d.color;
      const points: LatLng[] = [];
      for (let k = 1; k <= TRAIL_STEPS; k++) points.push(ll(geo.lonLatAt(d.trackFrac - k * TRAIL_SPACING)));
      out.push({ color, points });
    }
    return out;
  }, [geo, onTrack, selectedIds, driverA, driverB]);

  const subtitle = geo
    ? `${snapshot.circuitName} · ${onTrack.length} cars on track`
    : `${snapshot.circuitName} · no circuit survey — showing venue`;

  return (
    <AnalyticsCard
      eyebrow="Live · Track"
      title="Track position"
      subtitle={subtitle}
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
      {API_KEY && track && (
        <CircuitMap
          outline={track.outline}
          outlineColor={TRACK_BLUE}
          outlineWeight={4}
          drs={track.drs}
          ticks={track.ticks}
          labels={track.labels}
          cars={cars}
          trails={trails}
          basemap={basemap}
          fit={track.fit}
          fitKey={snapshot.circuitName}
          maxZoom={17}
        />
      )}
      {API_KEY && !track && (
        // Fallback: no surveyed geometry for this venue — show a bare
        // basemap centred on the reported location so the widget never
        // renders the wrong circuit (or breaks) at a new race.
        <CircuitMap
          basemap={basemap}
          fit={{ center: ll(snapshot.circuitCenter), zoom: 14 }}
          fitKey={snapshot.circuitName}
          maxZoom={17}
        />
      )}
    </AnalyticsCard>
  );
}
