/** Auto-revolving three.js earth for the race calendar.
 *
 *  - Lit sphere (directional key + ambient fill) with a baked equirectangular
 *    texture: ocean/land close in value, coastlines, tight faint graticule —
 *    shape comes from lighting, not fill contrast.
 *  - #245CFF atmosphere: tight fresnel rim + wider soft bloom shell,
 *    starfield backdrop, thin orbital ring, CSS vignette.
 *  - Season flight path as low cubic-bezier arcs (clamped altitude), styled
 *    by status: completed grey/faint, future amber, the active leg bright
 *    yellow and wide (px-width Line2 lines). A comet + aircraft fly the
 *    whole route in the active yellow.
 *  - Markers colored by status (completed/future/current), round labels.
 *  - Spins clockwise around the equator; drag, dot-hover or an open card
 *    eases it to a stop (and eases it back up — no hard start/stop); after
 *    4s idle only the tilt/zoom axis glides home (spin position kept).
 *  - Hover/click a dot (or click a schedule round via `focus`) → grown dot +
 *    frosted-glass metadata card, anchored to the marker's projected screen
 *    position and re-tracked every frame so it never detaches from its dot. */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { useChartTheme } from "@/components/charts/theme";
import {
  GLOBE_PALETTE as P,
  ROUTE_STYLES,
  LAND_POLYGONS,
  type CircuitDot,
  type RaceStatus,
  type RoutePoint,
} from "@/features/calendar/geo";
import { MetaCard, type DotHit } from "@/features/calendar/MetaCard";

const R = 1;
const HOME_R = 4.6; // default distance (20% further out than the previous 3.83)
const HOME_PHI = ((90 - 46) * Math.PI) / 180; // camera at ~46°N — Europe
const IDLE_RESET_MS = 4000;

function toVec3(lat: number, lon: number, r: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

/** Low, clamped arc altitude — long hops cap out instead of ballooning. */
function calculateArcAltitude(start: THREE.Vector3, end: THREE.Vector3, globeRadius: number) {
  const angle = start.angleTo(end);
  const minAltitude = globeRadius * 0.025;
  const maxAltitude = globeRadius * 0.15;
  return THREE.MathUtils.clamp(globeRadius * angle * 0.08, minAltitude, maxAltitude);
}

function createFlightCurve(start: THREE.Vector3, end: THREE.Vector3, globeRadius: number) {
  const altitude = calculateArcAltitude(start, end, globeRadius);
  const midpoint = start.clone().add(end).normalize().multiplyScalar(globeRadius + altitude);
  const controlPoint1 = start
    .clone()
    .lerp(midpoint, 0.55)
    .normalize()
    .multiplyScalar(globeRadius + altitude * 0.7);
  const controlPoint2 = end
    .clone()
    .lerp(midpoint, 0.55)
    .normalize()
    .multiplyScalar(globeRadius + altitude * 0.7);
  return new THREE.CubicBezierCurve3(start, controlPoint1, controlPoint2, end);
}

/** Equirectangular earth texture: ocean, filled land (close in value to the
 *  ocean — lighting does the shaping), hairline coasts and a tight faint
 *  graticule — baked once per scene build. */
function buildEarthCanvas(): HTMLCanvasElement {
  const w = 2048;
  const h = 1024;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  const px = (lon: number) => ((lon + 180) / 360) * w;
  const py = (lat: number) => ((90 - lat) / 180) * h;

  ctx.fillStyle = P.ocean;
  ctx.fillRect(0, 0, w, h);

  // land (unwrapped lons, drawn at ±360° offsets so antimeridian rings work)
  const land = new Path2D();
  for (const poly of LAND_POLYGONS)
    for (const ring of poly) {
      let prev = ring[0][0];
      for (let i = 0; i < ring.length; i++) {
        let [lon, lat] = ring[i];
        while (lon - prev > 180) lon -= 360;
        while (lon - prev < -180) lon += 360;
        prev = lon;
        if (i === 0) land.moveTo(px(lon), py(lat));
        else land.lineTo(px(lon), py(lat));
      }
      land.closePath();
    }
  ctx.fillStyle = P.land;
  ctx.strokeStyle = P.coast;
  ctx.lineWidth = 1.1;
  for (const dx of [-w, 0, w]) {
    ctx.save();
    ctx.translate(dx, 0);
    ctx.fill(land, "evenodd");
    ctx.stroke(land);
    ctx.restore();
  }

  // faint graticule — tight 10° cells
  ctx.strokeStyle = P.grid;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 0.75;
  for (let lon = -170; lon <= 180; lon += 10) {
    ctx.beginPath();
    ctx.moveTo(px(lon), 0);
    ctx.lineTo(px(lon), h);
    ctx.stroke();
  }
  for (let lat = -80; lat <= 80; lat += 10) {
    ctx.beginPath();
    ctx.moveTo(0, py(lat));
    ctx.lineTo(w, py(lat));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return cv;
}

const ATMOS_VERT = `
  varying vec3 vN;
  void main() {
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const ATMOS_FRAG = `
  varying vec3 vN;
  uniform vec3 uColor;
  uniform float uPow;
  uniform float uGain;
  void main() {
    float i = pow(max(0.65 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0), uPow) * uGain;
    gl_FragColor = vec4(uColor, 1.0) * i;
  }`;

const MARKER_COLOR: Record<RaceStatus, string> = {
  completed: P.markerCompleted,
  future: P.markerFuture,
  current: P.markerCurrent,
};

/** Status of the leg from stop i to stop i+1, judged by race dates. */
function legStatus(a: RoutePoint, b: RoutePoint, today: string): RaceStatus {
  if (b.date != null && b.date < today) return "completed";
  if (a.date != null && a.date < today && (b.date == null || b.date >= today)) return "current";
  return "future";
}

export interface GlobeFocus {
  circuitId: number;
  lat: number;
  lon: number;
  token: number; // bump to re-trigger the snap for the same circuit
}

export function Globe3D(props: {
  dots: CircuitDot[];
  /** season route in round order — drawn as the status-styled flight path */
  route: RoutePoint[];
  focus: GlobeFocus | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const C = useChartTheme();
  const { dots, route } = props;
  // the visible metadata card, anchored to its marker's projected position
  // and re-tracked every frame inside the render loop
  const [card, setCard] = useState<DotHit | null>(null);
  const snapRef = useRef<((lat: number, lon: number, circuitId?: number) => void) | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const t = C.t;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.copy(toVec3(46, 8, HOME_R)); // open hovering over Europe

    const disposables: { dispose: () => void }[] = [];
    const track = <T extends { dispose: () => void }>(d: T): T => {
      disposables.push(d);
      return d;
    };

    // lighting — a high key light plus ambient fill; land/ocean are close in
    // value, so the limb shading is what gives the sphere its shape
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.copy(toVec3(55, -20, 3)); // high over the opening Europe view
    scene.add(key);

    // earth — baked texture on a lit material
    const earthTex = track(new THREE.CanvasTexture(buildEarthCanvas()));
    earthTex.colorSpace = THREE.SRGBColorSpace;
    earthTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const sphere = new THREE.Mesh(
      track(new THREE.SphereGeometry(R, 64, 64)),
      track(new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.9, metalness: 0 })),
    );
    scene.add(sphere);

    // atmosphere — tight rim + wider soft bloom shell in the spec blue
    // (gains tuned to read as ~0.14 overall opacity)
    for (const [radius, pow, gain] of [
      [1.045, 3.0, 0.55],
      [1.14, 5.0, 0.22],
    ] as const) {
      scene.add(
        new THREE.Mesh(
          track(new THREE.SphereGeometry(R * radius, 64, 64)),
          track(
            new THREE.ShaderMaterial({
              transparent: true,
              blending: THREE.AdditiveBlending,
              side: THREE.BackSide,
              depthWrite: false,
              uniforms: {
                uColor: { value: new THREE.Color(P.atmosphere) },
                uPow: { value: pow },
                uGain: { value: gain },
              },
              vertexShader: ATMOS_VERT,
              fragmentShader: ATMOS_FRAG,
            }),
          ),
        ),
      );
    }

    // starfield backdrop — size/alpha tiers on a far shell (faint dust → bright)
    for (const [count, size, opacity] of [
      [2400, 1.1, 0.35], // sizeAttenuation:false → size is in px
      [1600, 1.6, 0.9],
      [800, 2.4, 0.65],
      [260, 3.4, 0.4],
    ] as const) {
      const starPos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        let x = 0;
        let y = 0;
        let z = 0;
        let len = 0;
        while (len < 1e-6) {
          x = Math.random() * 2 - 1;
          y = Math.random() * 2 - 1;
          z = Math.random() * 2 - 1;
          len = Math.hypot(x, y, z);
        }
        const r = 30;
        starPos[i * 3] = (x / len) * r;
        starPos[i * 3 + 1] = (y / len) * r;
        starPos[i * 3 + 2] = (z / len) * r;
      }
      const starGeom = track(new THREE.BufferGeometry());
      starGeom.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
      scene.add(
        new THREE.Points(
          starGeom,
          track(
            new THREE.PointsMaterial({
              color: "#dfe6f0",
              size,
              transparent: true,
              opacity,
              sizeAttenuation: false,
              depthWrite: false,
            }),
          ),
        ),
      );
    }

    // orbital ring — thin tilted accent circling the globe
    const orbital = new THREE.Mesh(
      track(new THREE.TorusGeometry(R * 1.5, 0.0015, 6, 200)),
      track(new THREE.MeshBasicMaterial({ color: t.inkMut, transparent: true, opacity: 0.35 })),
    );
    orbital.rotation.x = Math.PI / 2.4;
    orbital.rotation.y = 0.25;
    scene.add(orbital);

    // season flight path — low cubic-bezier arcs, one px-width Line2 per leg,
    // styled by leg status; the comet + aircraft fly the whole route
    const today = new Date().toISOString().slice(0, 10);
    const routeCurve = new THREE.CurvePath<THREE.Vector3>();
    const lineMats: LineMaterial[] = [];
    for (let i = 0; i < route.length - 1; i++) {
      const a = toVec3(route[i].lat, route[i].lon, R * 1.005);
      const b = toVec3(route[i + 1].lat, route[i + 1].lon, R * 1.005);
      const curve = createFlightCurve(a, b, R);
      // clamp every sample above the surface — the raw bezier dips inside the
      // sphere near its endpoints, which buried path segments "behind" the earth
      const pts = curve.getPoints(80).map((p) => {
        if (p.length() < R * 1.006) p.setLength(R * 1.006);
        return p;
      });
      routeCurve.add(new THREE.CatmullRomCurve3(pts));
      const style = ROUTE_STYLES[legStatus(route[i], route[i + 1], today)];
      const flat: number[] = [];
      for (const p of pts) flat.push(p.x, p.y, p.z);
      const geom = track(new LineGeometry());
      geom.setPositions(flat);
      const mat = track(
        new LineMaterial({
          color: new THREE.Color(style.color).getHex(),
          linewidth: style.width, // px (worldUnits: false)
          transparent: true,
          opacity: style.opacity,
          worldUnits: false,
          depthWrite: false,
        }),
      );
      lineMats.push(mat);
      const line = new Line2(geom, mat);
      line.computeLineDistances();
      scene.add(line);
    }
    // comet = px-width Line2 whose interleaved buffer is updated in place
    // every frame (no per-frame geometry allocation)
    const COMET_PTS = 24;
    let cometBuffer: THREE.InstancedInterleavedBuffer | null = null;
    const cometSegs = new Float32Array((COMET_PTS - 1) * 6);
    let plane: THREE.Mesh | null = null;
    if (routeCurve.curves.length > 0) {
      const cometMat = track(
        new LineMaterial({
          color: new THREE.Color(P.routeActive).getHex(),
          linewidth: 2.6,
          transparent: true,
          opacity: 0.95,
          worldUnits: false,
          depthWrite: false,
        }),
      );
      lineMats.push(cometMat);
      const cometGeom = track(new LineGeometry());
      cometGeom.setPositions(Array.from({ length: COMET_PTS * 3 }, () => 0));
      cometBuffer = (cometGeom.attributes.instanceStart as THREE.InterleavedBufferAttribute)
        .data as THREE.InstancedInterleavedBuffer;
      cometBuffer.setUsage(THREE.DynamicDrawUsage);
      scene.add(new Line2(cometGeom, cometMat));
      // the aircraft flying the route — small cone at the comet head
      plane = new THREE.Mesh(
        track(new THREE.ConeGeometry(0.011, 0.03, 6)),
        track(new THREE.MeshBasicMaterial({ color: P.routeActive })),
      );
      scene.add(plane);
    }

    // circuit markers, colored by status (userData carries the dot for picks)
    const dotGeom = track(new THREE.SphereGeometry(0.011, 12, 12));
    const bigGeom = track(new THREE.SphereGeometry(0.02, 16, 16));
    const markerMats: Record<RaceStatus, THREE.MeshBasicMaterial> = {
      completed: track(new THREE.MeshBasicMaterial({ color: MARKER_COLOR.completed })),
      future: track(new THREE.MeshBasicMaterial({ color: MARKER_COLOR.future })),
      current: track(new THREE.MeshBasicMaterial({ color: MARKER_COLOR.current })),
    };
    const ringMat = track(
      new THREE.MeshBasicMaterial({
        color: P.markerCurrent,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      }),
    );
    const ringGeom = track(new THREE.RingGeometry(0.03, 0.038, 32));
    const pulses: THREE.Mesh[] = [];
    const dotMeshes: THREE.Mesh[] = [];
    for (const d of dots) {
      const pos = toVec3(d.lat, d.lon, R * 1.006);
      const mesh = new THREE.Mesh(d.emphasis ? bigGeom : dotGeom, markerMats[d.status]);
      mesh.position.copy(pos);
      mesh.userData.dot = d;
      scene.add(mesh);
      dotMeshes.push(mesh);
      if (d.emphasis) {
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.copy(pos);
        ring.lookAt(pos.clone().multiplyScalar(2));
        scene.add(ring);
        pulses.push(ring);
      }
      // round label beside the dot ("R3"), always camera-facing
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.font = "600 34px 'JetBrains Mono Variable', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = d.status === "current" ? P.textPrimary : P.textSecondary;
        ctx.fillText(d.label, 64, 32);
        const tex = track(new THREE.CanvasTexture(canvas));
        const sprite = new THREE.Sprite(
          track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true })),
        );
        sprite.position.copy(toVec3(d.lat, d.lon, R * 1.045));
        sprite.scale.set(0.07, 0.035, 1);
        scene.add(sprite);
      }
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = -0.6; // negative → clockwise around the equator
    controls.zoomSpeed = 0.5;
    controls.minDistance = 2.25; // deepest zoom-in kept from the old home
    controls.maxDistance = 5.9; // ~+30% of home distance

    // interaction state — rotation eases to a halt while dragging, hovering a
    // dot, showing a card, or gliding to a focus; it always eases back up
    let dragging = false;
    let hoveredMesh: THREE.Mesh | null = null;
    let hoverDot: CircuitDot | null = null;
    // set by schedule-list clicks; forgotten when another dot is hovered or
    // empty space is clicked
    let pinnedDot: CircuitDot | null = null;
    let tiltResetting = false;
    let focusTarget: THREE.Vector3 | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    controls.addEventListener("start", () => {
      dragging = true;
      tiltResetting = false;
      focusTarget = null;
      clearTimeout(idleTimer);
    });
    controls.addEventListener("end", () => {
      dragging = false;
      clearTimeout(idleTimer);
      // idle: bring only the tilt/zoom axis home — keep the spin position
      idleTimer = setTimeout(() => {
        tiltResetting = true;
      }, IDLE_RESET_MS);
    });

    let focusDotId: number | null = null;
    snapRef.current = (lat: number, lon: number, circuitId?: number) => {
      focusTarget = toVec3(lat, lon, camera.position.length());
      focusDotId = circuitId ?? null;
      tiltResetting = false;
    };

    // hover / click raycast against the dot meshes
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (e: PointerEvent | MouseEvent): DotHit | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      pointer.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(dotMeshes, false)[0];
      // ignore dots on the far side of the globe
      if (!hit || hit.object.position.dot(camera.position) < 0) return null;
      return { dot: hit.object.userData.dot as CircuitDot, x, y };
    };
    const onMove = (e: PointerEvent) => {
      const h = pick(e);
      renderer.domElement.style.cursor = h ? "pointer" : "grab";
      const mesh = h
        ? dotMeshes.find((m) => (m.userData.dot as CircuitDot).circuitId === h.dot.circuitId) ??
          null
        : null;
      if (mesh !== hoveredMesh) {
        hoveredMesh?.scale.setScalar(1);
        mesh?.scale.setScalar(1.8);
        hoveredMesh = mesh;
      }
      // hovering a different dot forgets the clicked one for good
      if (h && pinnedDot && pinnedDot.circuitId !== h.dot.circuitId) pinnedDot = null;
      hoverDot = h?.dot ?? null;
    };
    const onClick = (e: MouseEvent) => {
      const h = pick(e);
      if (h) {
        pinnedDot = h.dot; // click pins the card so it survives pointer-out
      } else {
        for (const m of dotMeshes) m.scale.setScalar(1); // clear focus growth
        pinnedDot = null;
      }
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("click", onClick);

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      for (const m of lineMats) m.resolution.set(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    let spin = 1; // eased auto-rotate speed factor (0 = held, 1 = full)
    const clock = new THREE.Clock();
    const spherical = new THREE.Spherical();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const s = 1 + 0.18 * Math.sin(clock.getElapsedTime() * 2.4);
      for (const p of pulses) p.scale.setScalar(s);

      // comet along the flight path — sliding trail written into the reused buffer
      if (cometBuffer && routeCurve.curves.length > 0) {
        const u = (clock.getElapsedTime() * 0.018) % 1;
        let prev = routeCurve.getPointAt(Math.max(0, u - 0.02));
        for (let k = 1; k < COMET_PTS; k++) {
          const uu = Math.max(0, u - 0.02 + (0.02 * k) / (COMET_PTS - 1));
          const p = routeCurve.getPointAt(uu);
          const o = (k - 1) * 6;
          cometSegs[o] = prev.x;
          cometSegs[o + 1] = prev.y;
          cometSegs[o + 2] = prev.z;
          cometSegs[o + 3] = p.x;
          cometSegs[o + 4] = p.y;
          cometSegs[o + 5] = p.z;
          prev = p;
        }
        (cometBuffer.array as Float32Array).set(cometSegs);
        cometBuffer.needsUpdate = true;
        // aircraft rides the head of the comet, nose along the direction of travel
        if (plane) {
          const head = routeCurve.getPointAt(u);
          const ahead = routeCurve.getPointAt(Math.min(u + 0.003, 1));
          plane.position.copy(head);
          const dir = ahead.clone().sub(head);
          if (dir.lengthSq() > 1e-10)
            plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        }
      }

      if (focusTarget) {
        camera.position.lerp(focusTarget, 0.12);
        if (camera.position.distanceTo(focusTarget) < 0.01) {
          // arrived: grow the focused dot and pin its metadata card
          if (focusDotId != null) {
            const mesh = dotMeshes.find(
              (m) => (m.userData.dot as CircuitDot).circuitId === focusDotId,
            );
            if (mesh) {
              for (const m of dotMeshes) m.scale.setScalar(1);
              mesh.scale.setScalar(1.8);
              pinnedDot = mesh.userData.dot as CircuitDot;
            }
            focusDotId = null;
          }
          focusTarget = null;
        }
      } else if (tiltResetting) {
        // glide phi (tilt) + radius home, keep theta (spin) where it is
        spherical.setFromVector3(camera.position);
        spherical.phi += (HOME_PHI - spherical.phi) * 0.06;
        spherical.radius += (HOME_R - spherical.radius) * 0.06;
        camera.position.setFromSpherical(spherical);
        if (
          Math.abs(spherical.phi - HOME_PHI) < 0.005 &&
          Math.abs(spherical.radius - HOME_R) < 0.01
        )
          tiltResetting = false;
      }

      // card anchored to the marker's projected position, tracked every frame
      // so it stays glued to its dot through damping, glides, and drags
      const activeDot = hoverDot ?? pinnedDot;
      if (activeDot) {
        const mesh = dotMeshes.find(
          (m) => (m.userData.dot as CircuitDot).circuitId === activeDot.circuitId,
        );
        if (!mesh || mesh.position.dot(camera.position) < 0) {
          // dot rotated behind the globe — drop the card (and any pin)
          if (pinnedDot?.circuitId === activeDot.circuitId) pinnedDot = null;
          setCard(null);
        } else {
          const v = mesh.position.clone().project(camera);
          const x = ((v.x + 1) / 2) * renderer.domElement.clientWidth;
          const y = ((1 - v.y) / 2) * renderer.domElement.clientHeight;
          setCard((c) =>
            c &&
            c.dot.circuitId === activeDot.circuitId &&
            Math.abs(c.x - x) < 0.5 &&
            Math.abs(c.y - y) < 0.5
              ? c
              : { dot: activeDot, x, y },
          );
        }
      } else {
        setCard((c) => (c ? null : c));
      }

      // rotation eases out while dragging, hovering, showing a card, or
      // gliding to a focus — and eases back in when the interaction ends
      const spinTarget = dragging || activeDot || focusTarget ? 0 : 1;
      spin += (spinTarget - spin) * 0.06;
      controls.autoRotate = spin > 0.002;
      controls.autoRotateSpeed = -0.6 * spin;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // don't burn frames while the tab is hidden
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        clock.getDelta();
        animate();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      snapRef.current = null;
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("click", onClick);
      ro.disconnect();
      controls.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      setCard(null);
    };
  }, [C, dots, route]);

  // schedule-list clicks → snap the camera onto that circuit
  const { focus } = props;
  useEffect(() => {
    if (focus) snapRef.current?.(focus.lat, focus.lon, focus.circuitId);
  }, [focus]);

  return (
    <div ref={hostRef} className="absolute inset-0" aria-label="Race calendar globe">
      {/* subtle vignette above the canvas, below the overlay cards */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)",
        }}
      />
      {card && (
        <MetaCard
          hit={card}
          hostWidth={hostRef.current?.clientWidth ?? 0}
          hostHeight={hostRef.current?.clientHeight ?? 0}
        />
      )}
    </div>
  );
}
