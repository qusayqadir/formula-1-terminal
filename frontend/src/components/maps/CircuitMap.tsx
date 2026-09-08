import { useEffect, useMemo, useRef } from "react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { useChartTheme } from "@/components/charts/theme";
import { withAlpha } from "@/lib/colors";

/** Generic dark-basemap circuit map, rendered on the Google Maps JS API. It
 *  shows a terminal-dark Google basemap (real streets/water/land, POI clutter
 *  styled out) and draws whatever geometry it is handed on top: a track
 *  outline, a speed-heatmap surface, DRS zones, corner/sector text labels,
 *  live car markers and short trails. Polylines are drawn as native
 *  google.maps.Polyline layers; text labels and car markers ride a single
 *  google.maps.OverlayView so they stay pixel-sized and never intercept map
 *  gestures. It owns no F1 knowledge — the caller computes lat/lng geometry
 *  and passes it in. Must be mounted inside the app's <APIProvider>. */

const MONO = "JetBrains Mono Variable, monospace";
type LatLng = [number, number];

export interface CircuitMapCar {
  id: number;
  code: string;
  color: string;
  lat: number;
  lng: number;
  selected?: boolean;
}

export interface CircuitMapLabel {
  lat: number;
  lng: number;
  text: string;
  color: string;
  size: number;
  weight?: number;
}

export interface CircuitMapSegment {
  a: LatLng;
  b: LatLng;
  color: string;
}

export interface CircuitMapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface CircuitMapProps {
  /** track centreline — drawn as the outline line AND used to auto-fit */
  outline?: LatLng[];
  outlineColor?: string;
  outlineWeight?: number;
  /** per-segment coloured surface (speed heatmap); rendered under the outline */
  segments?: CircuitMapSegment[];
  segmentWeight?: number;
  /** DRS-zone accent overlays */
  drs?: LatLng[][];
  /** short cross-track ticks (sector splits, start/finish) */
  ticks?: { path: LatLng[]; strong?: boolean }[];
  /** text labels (corner numbers, S1/S2/S3, DRS) */
  labels?: CircuitMapLabel[];
  /** live car markers */
  cars?: CircuitMapCar[];
  /** short fading trail behind each selected car (most-recent first) */
  trails?: { color: string; points: LatLng[] }[];
  /** basemap type — "roadmap" gets the terminal-dark styled map (default),
   *  "satellite"/"hybrid" swap in Google's aerial imagery (Google ignores the
   *  custom dark `styles` on those, showing real photography). */
  basemap?: "roadmap" | "satellite" | "hybrid";
  /** what to frame on mount / when `fitKey` changes */
  fit?: { bounds?: CircuitMapBounds; center?: LatLng; zoom?: number };
  /** bump to re-run the fit (e.g. circuit changed) without remounting */
  fitKey?: string | number;
  interactive?: boolean;
  minZoom?: number;
  maxZoom?: number;
  className?: string;
}

/** google.maps.Polyline wants a solid strokeColor + a separate strokeOpacity;
 *  our theme mixes hex tokens with rgba() washes (withAlpha). Normalise either
 *  form into {strokeColor, strokeOpacity}, folding any rgba alpha into the
 *  supplied base opacity. */
function stroke(color: string, opacity: number): { strokeColor: string; strokeOpacity: number } {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a] = m[1].split(",").map((s) => parseFloat(s));
    const hex = "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
    return { strokeColor: hex, strokeOpacity: opacity * (Number.isNaN(a) ? 1 : a) };
  }
  return { strokeColor: color, strokeOpacity: opacity };
}

/** Terminal-dark Google basemap style: muted dark land/water, hairline roads,
 *  no business/landmark POI pins — the same "clean dark reference map under
 *  the track" look, native to Google. */
const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#12151a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6b7280" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0c0e12" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1c2027" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "simplified" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#272c34" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#2a2e34" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b1a2b" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#151a1f" }] },
];

const carIconHtml = (car: CircuitMapCar, surface: string, raised: string, ink: string, inkSub: string): string => {
  const sel = car.selected;
  const r = sel ? 11 : 7;
  const fs = sel ? 9.5 : 7.5;
  const pillBg = withAlpha(raised, sel ? 0.92 : 0.72);
  const pillBorder = withAlpha(ink, sel ? 0.3 : 0.16);
  return `
    <div style="position:relative">
      <div style="position:absolute;left:${-r}px;top:${-r}px;width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:${withAlpha(car.color, sel ? 0.26 : 0.14)}"></div>
      <div style="position:absolute;left:${-r / 2}px;top:${-r / 2}px;width:${r}px;height:${r}px;border-radius:50%;background:${car.color};border:${sel ? 2 : 1.25}px solid ${surface};box-shadow:0 1px 2px rgba(0,0,0,.6)"></div>
      <div style="position:absolute;left:50%;top:${r / 2 + 3}px;transform:translateX(-50%);padding:0 3px;border-radius:3px;background:${pillBg};border:.75px solid ${pillBorder};font:${sel ? 700 : 500} ${fs}px ${MONO};color:${sel ? ink : inkSub};line-height:13px;white-space:nowrap">${car.code}</div>
    </div>`;
};

const textIconHtml = (label: CircuitMapLabel, surface: string): string =>
  `<div style="transform:translate(-50%,-50%);font:${label.weight ?? 700} ${label.size}px ${MONO};color:${label.color};white-space:nowrap;text-shadow:0 0 2px ${surface},0 0 2px ${surface},0 1px 2px rgba(0,0,0,.7)">${label.text}</div>`;

/** Native polyline layers (casing / heatmap / DRS / ticks / trails). Re-created
 *  whenever the geometry changes; cleaned up by detaching each line. */
function Geometry(props: CircuitMapProps & { outlineColor: string; ink: string; inkMut: string; accent: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map || typeof google === "undefined") return;
    const lines: google.maps.Polyline[] = [];
    const draw = (path: LatLng[], opts: google.maps.PolylineOptions) => {
      lines.push(
        new google.maps.Polyline({ path: path.map(([lat, lng]) => ({ lat, lng })), map, clickable: false, ...opts }),
      );
    };

    // track outline — thick dark casing the heatmap segments sit on top of
    if (props.outline && props.outline.length > 1) {
      draw(props.outline, { ...stroke(props.outlineColor, 0.95), strokeWeight: props.outlineWeight ?? 3, zIndex: 1 });
    }
    // speed-heatmap surface, over the casing
    for (const s of props.segments ?? []) {
      draw([s.a, s.b], { ...stroke(s.color, 0.95), strokeWeight: props.segmentWeight ?? 5, zIndex: 2 });
    }
    // DRS zones
    for (const pts of props.drs ?? []) {
      draw(pts, { ...stroke(props.accent, 0.75), strokeWeight: 3, zIndex: 3 });
    }
    // sector / start-finish ticks
    for (const tk of props.ticks ?? []) {
      draw(tk.path, { ...stroke(tk.strong ? props.ink : props.inkMut, 0.9), strokeWeight: tk.strong ? 3 : 1.5, zIndex: 4 });
    }
    // fading trails behind selected cars
    for (const tr of props.trails ?? []) {
      tr.points.forEach((p, pi) => {
        const opacity = 0.34 * (1 - (pi + 1) / (tr.points.length + 1));
        const seg: LatLng[] = pi === 0 ? [p, p] : [tr.points[pi - 1], p];
        draw(seg, { ...stroke(tr.color, opacity), strokeWeight: 3, zIndex: 5 });
      });
    }

    return () => lines.forEach((l) => l.setMap(null));
  }, [map, props]);
  return null;
}

/** Single OverlayView carrying every text label as an absolutely positioned
 *  HTML node — repositioned in draw() so they track the map without a marker
 *  instance per element. Static: rebuilt only when the labels/theme change,
 *  never on a car tick (cars live on their own animated overlay). */
function Overlays(props: { labels?: CircuitMapLabel[]; surface: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map || typeof google === "undefined") return;

    class HtmlLayer extends google.maps.OverlayView {
      readonly root = document.createElement("div");
      onAdd() {
        this.root.style.position = "absolute";
        // markerLayer sits ABOVE overlayLayer (where the track/heatmap
        // Polylines draw), so labels are never hidden under the track.
        // pointer-events off so the decorative layer never eats map
        // drags/zoom.
        this.root.style.pointerEvents = "none";
        this.getPanes()?.markerLayer.appendChild(this.root);
      }
      draw() {
        const proj = this.getProjection();
        if (!proj) return;
        for (const child of Array.from(this.root.children) as HTMLElement[]) {
          const p = proj.fromLatLngToDivPixel(
            new google.maps.LatLng(Number(child.dataset.lat), Number(child.dataset.lng)),
          );
          if (p) {
            child.style.left = `${p.x}px`;
            child.style.top = `${p.y}px`;
          }
        }
      }
      onRemove() {
        this.root.remove();
      }
    }

    const layer = new HtmlLayer();
    for (const label of props.labels ?? []) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.dataset.lat = String(label.lat);
      el.dataset.lng = String(label.lng);
      el.innerHTML = textIconHtml(label, props.surface);
      layer.root.appendChild(el);
    }

    layer.setMap(map);
    return () => layer.setMap(null);
  }, [map, props.labels, props.surface]);
  return null;
}

/** Wall-clock window (ms) a car marker takes to glide from its previous
 *  position to the newly-received one. Matched to the ~500 ms snapshot tick so
 *  each glide finishes just as the next position arrives — the dot moves at a
 *  steady pace instead of teleporting twice a second. */
const CAR_ANIM_MS = 500;

/** Car markers on their own OverlayView, created ONCE per map and kept alive
 *  across snapshot ticks. Each new `cars` prop only updates per-marker
 *  animation targets; a requestAnimationFrame loop lerps every marker from its
 *  current lat/lng to the target over CAR_ANIM_MS and writes the interpolated
 *  position straight to the DOM (no React re-render per frame, so the track
 *  polylines aren't rebuilt 60×/s). Linear lat/lng interpolation is used — over
 *  a single tick the arc between consecutive points is tiny, so the chord is
 *  visually on-track, and it needs no lap-fraction wrap handling. */
function CarOverlay(props: { cars?: CircuitMapCar[]; surface: string; raised: string; ink: string; inkSub: string }) {
  const map = useMap();
  const layerRef = useRef<{
    update: (cars: CircuitMapCar[], theme: { surface: string; raised: string; ink: string; inkSub: string }) => void;
    dispose: () => void;
  } | null>(null);

  // Create the overlay once per map. Google's OverlayView isn't defined until
  // the JS API loads, so the class is declared inside the effect.
  useEffect(() => {
    if (!map || typeof google === "undefined") return;

    type Entry = {
      el: HTMLElement;
      cur: { lat: number; lng: number };
      from: { lat: number; lng: number };
      to: { lat: number; lng: number };
      start: number;
    };

    class CarLayer extends google.maps.OverlayView {
      readonly root = document.createElement("div");
      readonly entries = new globalThis.Map<number, Entry>();
      raf = 0;

      onAdd() {
        this.root.style.position = "absolute";
        this.root.style.pointerEvents = "none";
        this.getPanes()?.markerLayer.appendChild(this.root);
      }

      /** Reposition every marker from its current (interpolated) lat/lng —
       *  called by Google on pan/zoom AND by the animation loop each frame. */
      draw() {
        const proj = this.getProjection();
        if (!proj) return;
        for (const e of this.entries.values()) {
          const p = proj.fromLatLngToDivPixel(new google.maps.LatLng(e.cur.lat, e.cur.lng));
          if (p) {
            e.el.style.left = `${p.x}px`;
            e.el.style.top = `${p.y}px`;
          }
        }
      }

      /** Take in a fresh car list: retarget existing markers (gliding from
       *  where they currently sit), spawn new ones at rest, drop departed ones. */
      update(cars: CircuitMapCar[], theme: { surface: string; raised: string; ink: string; inkSub: string }) {
        const now = performance.now();
        const seen = new Set<number>();
        for (const car of cars) {
          seen.add(car.id);
          const html = carIconHtml(car, theme.surface, theme.raised, theme.ink, theme.inkSub);
          const existing = this.entries.get(car.id);
          if (existing) {
            existing.el.innerHTML = html; // refresh colour / selected pill
            existing.from = { ...existing.cur };
            existing.to = { lat: car.lat, lng: car.lng };
            existing.start = now;
          } else {
            const el = document.createElement("div");
            el.style.position = "absolute";
            el.innerHTML = html;
            this.root.appendChild(el);
            const pos = { lat: car.lat, lng: car.lng };
            this.entries.set(car.id, { el, cur: { ...pos }, from: { ...pos }, to: { ...pos }, start: now });
          }
        }
        for (const [id, e] of this.entries) {
          if (!seen.has(id)) {
            e.el.remove();
            this.entries.delete(id);
          }
        }
        this.ensureRaf();
      }

      private ensureRaf() {
        if (this.raf) return;
        const step = () => {
          const now = performance.now();
          let animating = false;
          for (const e of this.entries.values()) {
            const t = Math.min(1, (now - e.start) / CAR_ANIM_MS);
            e.cur.lat = e.from.lat + (e.to.lat - e.from.lat) * t;
            e.cur.lng = e.from.lng + (e.to.lng - e.from.lng) * t;
            if (t < 1) animating = true;
          }
          this.draw();
          this.raf = animating ? requestAnimationFrame(step) : 0;
        };
        this.raf = requestAnimationFrame(step);
      }

      dispose() {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
      }

      onRemove() {
        this.dispose();
        this.root.remove();
      }
    }

    const layer = new CarLayer();
    layer.setMap(map);
    layerRef.current = layer;
    return () => {
      layer.dispose();
      layer.setMap(null);
      layerRef.current = null;
    };
  }, [map]);

  // Feed each new car list to the persistent layer as animation targets.
  useEffect(() => {
    layerRef.current?.update(props.cars ?? [], props);
  }, [props.cars, props.surface, props.raised, props.ink, props.inkSub]);

  return null;
}

/** Re-frames the map on mount and whenever `fitKey` changes — never on every
 *  car tick, so panning/zooming a live map isn't yanked back each frame. */
function Framer(props: { fit?: CircuitMapProps["fit"]; fitKey?: string | number }) {
  const map = useMap();
  useEffect(() => {
    const f = props.fit;
    if (!map || !f) return;
    if (f.bounds) {
      map.fitBounds(f.bounds, 28);
    } else if (f.center) {
      map.setCenter({ lat: f.center[0], lng: f.center[1] });
      map.setZoom(f.zoom ?? 15);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, props.fitKey]);
  return null;
}

export function CircuitMap(props: CircuitMapProps) {
  const { t } = useChartTheme();
  const interactive = props.interactive ?? true;

  const defaultCenter = useMemo(() => {
    const b = props.fit?.bounds;
    if (b) return { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
    if (props.fit?.center) return { lat: props.fit.center[0], lng: props.fit.center[1] };
    return { lat: 0, lng: 0 };
  }, [props.fit]);

  return (
    <div className={props.className} style={{ width: "100%", height: "100%", background: t.surface }}>
      <Map
        style={{ width: "100%", height: "100%" }}
        defaultCenter={defaultCenter}
        defaultZoom={props.fit?.zoom ?? 15}
        minZoom={props.minZoom ?? 2}
        maxZoom={props.maxZoom ?? 18}
        mapTypeId={props.basemap ?? "roadmap"}
        styles={MAP_STYLES}
        backgroundColor={t.surface}
        clickableIcons={false}
        // strip Google's default chrome (map-type toggle, Street View pegman,
        // fullscreen, rotate) for the terminal look — keep only a minimal zoom
        // control when the map is interactive, matching the old Leaflet map
        disableDefaultUI
        zoomControl={interactive}
        mapTypeControl={false}
        streetViewControl={false}
        fullscreenControl={false}
        rotateControl={false}
        scaleControl={false}
        gestureHandling={interactive ? "greedy" : "none"}
        keyboardShortcuts={false}
      >
        <Geometry
          {...props}
          outlineColor={props.outlineColor ?? withAlpha(t.ink, 0.85)}
          ink={t.ink}
          inkMut={t.inkMut}
          accent={t.accent}
        />
        <Overlays labels={props.labels} surface={t.surface} />
        <CarOverlay cars={props.cars} surface={t.surface} raised={t.raised} ink={t.ink} inkSub={t.inkSub} />
        <Framer fit={props.fit} fitKey={props.fitKey} />
      </Map>
    </div>
  );
}
