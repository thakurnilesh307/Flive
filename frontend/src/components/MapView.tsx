import { useEffect, useRef } from "react";
import {
  Map as GLMap, Marker, Popup, setWorkerUrl,
  type ExpressionSpecification, type GeoJSONSource, type MapLayerMouseEvent, type SymbolLayerSpecification,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { Derived } from "../status";
import type { BBox, LatLon } from "../types";
import { KBOS, MS_TO_KT, project } from "../geo";
import { flightLabel } from "../format";
import { PLANE_PATH } from "./icons";
import { restyleBasemap } from "../basemap";

// After bundling, MapLibre can't find its worker next to our JS; tell it where Vite put it.
setWorkerUrl(maplibreWorkerUrl);

interface Props {
  /** Boston aircraft (5 s feed), with derived status */
  aircraft: Derived[];
  /** worldwide aircraft in view (slower feed), already minus the Boston ones */
  world: Derived[];
  selectedId: string | null;
  /** ids hidden by the search filter (dimmed on the map), or null for none */
  dimmed: Set<string> | null;
  trail: LatLon[];
  clockSkew: number;
  onSelect: (id: string | null) => void;
  onMapReady: (map: GLMap) => void;
  /** called (debounced) with the visible bounds whenever the view changes */
  onViewChange?: (bbox: BBox, center: LatLon, zoom: number) => void;
  /** keep the camera centred on the selected plane */
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  theme: "dark" | "light";
}

const STALE_S = 30;              // fade aircraft we haven't heard from in this long
const MAX_EXTRAPOLATE_S = 20;    // Boston: never dead-reckon further than this
const GROUND_EXTRAPOLATE_S = 4;  // taxiing planes turn often: glide only briefly past the last fix
const GROUND_MOVING_MS = 1.5;    // ~3 kt: slower than this on the ground = parked, don't move it
const WORLD_EXTRAPOLATE_S = 120; // world updates are ~90 s apart; cap the glide a bit beyond that
const LOCAL_FRAME_MS = 33;  // Boston planes redraw ~30 times a second (few planes, cheap)
const WORLD_FRAME_MS = 250; // world planes redraw 4 times a second (up to 2,000 planes)
const LOCAL_BLEND_MS = 1200; // when a real position arrives, slide to it over this long instead of snapping
const WORLD_BLEND_MS = 2500;
const MAX_BLEND_DEG = 0.3;
const FOLLOW_ZOOM = 11;       // clicking a plane zooms in at least this far
const FLY_IN_MS = 900;        // how long the zoom-in to a clicked plane takes
const VIEW_REPORT_MAX_MS = 1500; // while following, the map moves every frame: still report the view this often   // corrections bigger than this (~18 nm) are real jumps: snap
const STYLES = {
  dark: "https://tiles.openfreemap.org/styles/dark",       // recoloured slate grey in basemap.ts
  light: "https://tiles.openfreemap.org/styles/positron",
};
// Aircraft and trail colours per theme (planes are one white SDF image, recoloured here).
const PLANE_COLORS = {
  dark: { sel: "#4c9be8", ground: "#717a85", air: "#e3e7ec", haloSel: "rgba(15,19,24,0.95)", halo: "rgba(15,19,24,0.85)", trail: "#4c9be8" },
  light: { sel: "#1f5fae", ground: "#8a929c", air: "#17202a", haloSel: "rgba(248,249,251,0.95)", halo: "rgba(248,249,251,0.9)", trail: "#1f5fae" },
};
type FC = FeatureCollection<Geometry>;

function estimate(d: Derived, serverNow: number, cap: number): LatLon | null {
  const a = d.a;
  if (a.lat == null || a.lon == null) return null;
  if (a.velocity_ms == null || a.track_deg == null || a.time_position == null
    || (a.on_ground && a.velocity_ms < GROUND_MOVING_MS)) {
    return [a.lat, a.lon];
  }
  // Taxiing planes glide too, but only a few seconds: the next fix (every ~2 s for a
  // followed plane) arrives before a turn takes it far off the projected line.
  const dt = Math.min(a.on_ground ? Math.min(cap, GROUND_EXTRAPOLATE_S) : cap, Math.max(0, serverNow - a.time_position));
  return project([a.lat, a.lon], a.track_deg, a.velocity_ms * MS_TO_KT, dt);
}

/** Plane silhouette as a white SDF image, so layers can recolor it (icon-color). */
function planeImage(size = 64): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = "#fff";
  ctx.fill(new Path2D(PLANE_PATH));
  return ctx.getImageData(0, 0, size, size);
}

const empty = (): FC => ({ type: "FeatureCollection", features: [] });

/**
 * Hides the snap when a fresh position arrives. Dead reckoning puts a plane slightly
 * off from where the next real report says it is; instead of jumping there, we
 * remember the gap and shrink it to zero over `blendMs`.
 */
function makeSmoother(blendMs: number) {
  const shown = new Map<string, LatLon>();   // where each plane was last drawn
  const seenTp = new Map<string, number>();  // last time_position we saw per plane
  const gap = new Map<string, { dLat: number; dLon: number; t0: number }>();
  const ease = (t: number) => t * t * (3 - 2 * t); // smoothstep

  function place(id: string, tp: number | null | undefined, est: LatLon, now: number): LatLon {
    const prevTp = seenTp.get(id);
    const prev = shown.get(id);
    if (tp != null) seenTp.set(id, tp);
    if (prev && tp != null && prevTp != null && tp !== prevTp) {
      let dLon = prev[1] - est[1];
      if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
      const dLat = prev[0] - est[0];
      if (Math.abs(dLat) < MAX_BLEND_DEG && Math.abs(dLon) < MAX_BLEND_DEG) gap.set(id, { dLat, dLon, t0: now });
      else gap.delete(id);
    }
    let pos = est;
    const g = gap.get(id);
    if (g) {
      const t = (now - g.t0) / blendMs;
      if (t >= 1) gap.delete(id);
      else {
        const k = 1 - ease(t);
        pos = [est[0] + g.dLat * k, est[1] + g.dLon * k];
      }
    }
    shown.set(id, pos);
    return pos;
  }

  /** Forget planes that left the feed so the maps don't grow forever. */
  function prune(alive: Set<string>) {
    if (shown.size <= alive.size + 100) return;
    for (const m of [shown, seenTp, gap]) for (const id of m.keys()) if (!alive.has(id)) m.delete(id);
  }

  return { place, prune };
}

/**
 * Visible lat/lon box from the map's own pixel size: unproject a ring of points
 * along the edges. More reliable than getBounds() with globe projection, and
 * edge points that fall off the globe (space) are skipped.
 */
function visibleBox(map: GLMap): BBox {
  if (map.getZoom() < 2.5) return [-180, -85, 180, 85];      // globe view: whole world
  const c = map.getCanvas();
  const w = c.clientWidth, h = c.clientHeight;
  const lons: number[] = [], lats: number[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    for (const [x, y] of [[(w * i) / steps, 0], [(w * i) / steps, h], [0, (h * i) / steps], [w, (h * i) / steps]]) {
      const p = map.unproject([x, y]);
      if (Number.isFinite(p.lng) && Number.isFinite(p.lat)) { lons.push(p.lng); lats.push(p.lat); }
    }
  }
  if (!lons.length) return [-180, -85, 180, 85];
  // Unwrap longitudes around the center so a view crossing ±180 stays one span.
  const center = map.getCenter().lng;
  const un = lons.map((lo) => center + ((((lo - center) % 360) + 540) % 360) - 180);
  return [Math.min(...un), Math.max(-90, Math.min(...lats)), Math.max(...un), Math.min(90, Math.max(...lats))];
}

/**
 * Camera padding so a followed plane sits in the middle of the part of the map you
 * can actually see, not behind the detail panel (right) or flight list (bottom).
 */
function freePadding(map: GLMap) {
  const box = map.getCanvasContainer().getBoundingClientRect();
  const pad = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const el of document.querySelectorAll<HTMLElement>(".detail, .table-panel")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.left > box.left + box.width * 0.5) pad.right = Math.max(pad.right, box.right - r.left);
    else if (r.top > box.top + box.height * 0.3) pad.bottom = Math.max(pad.bottom, box.bottom - r.top);
  }
  // Never squeeze the usable area below ~200 px.
  pad.right = Math.min(pad.right, Math.max(0, box.width - 200));
  pad.bottom = Math.min(pad.bottom, Math.max(0, box.height - 200));
  return pad;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export default function MapView(props: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GLMap | null>(null);
  const ready = useRef(false);
  const redraw = useRef<(() => void) | null>(null);
  const startFollow = useRef<(() => void) | null>(null);

  // Latest props for timers and MapLibre callbacks.
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const map = new GLMap({
      container: divRef.current!,
      style: STYLES[live.current.theme],
      center: [KBOS[1], KBOS[0]],
      zoom: 10,
      minZoom: 1.2,
      maxZoom: 15,
      attributionControl: false, // credits are rendered by App, below the flight list
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    // KBOS marker: static markup only (no provider data in HTML strings).
    const kbos = document.createElement("div");
    kbos.className = "kbos-marker";
    kbos.innerHTML = `<div class="kbos-dot"></div><div class="kbos-label">KBOS</div>`;
    new Marker({ element: kbos, anchor: "center" }).setLngLat([KBOS[1], KBOS[0]]).addTo(map);

    const tip = new Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "ac-tip" });

    // Runs on the first load AND after every theme switch (setStyle wipes our image,
    // sources and layers, so they're added back here; the event handlers below stay).
    let wired = false;
    map.on("style.load", () => {
      const theme = live.current.theme;
      const c = PLANE_COLORS[theme];
      restyleBasemap(map, theme);
      map.setProjection({ type: "globe" });   // globe when zoomed out, flat map when zoomed in
      if (!map.hasImage("plane")) map.addImage("plane", planeImage(), { sdf: true, pixelRatio: 2 });

      for (const id of ["trail", "world", "local"]) {
        if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: empty() });
      }

      map.addLayer({
        id: "trail", type: "line", source: "trail",
        paint: { "line-color": c.trail, "line-width": 2.5, "line-dasharray": [1.5, 2.5], "line-opacity": 0.9 },
      });

      // Shared look for both aircraft layers; data-driven by feature properties.
      const scale: ExpressionSpecification =
        ["*", ["case", ["get", "ground"], 0.62, 1], ["case", ["get", "sel"], 1.3, 1]];
      const planeLayout: SymbolLayerSpecification["layout"] = {
        "icon-image": "plane",
        "icon-rotate": ["get", "rot"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        // "zoom" must be the top-level input, so the per-plane scale goes inside each stop.
        "icon-size": ["interpolate", ["linear"], ["zoom"],
          1, ["*", 0.32, scale], 5, ["*", 0.45, scale], 9, ["*", 0.62, scale], 13, ["*", 0.72, scale]],
        "symbol-sort-key": ["case", ["get", "sel"], 2, ["get", "ground"], 0, 1],
      };
      const planePaint: SymbolLayerSpecification["paint"] = {
        "icon-color": ["case", ["get", "sel"], c.sel, ["get", "ground"], c.ground, c.air],
        "icon-halo-color": ["case", ["get", "sel"], c.haloSel, c.halo],
        "icon-halo-width": ["case", ["get", "sel"], 3, ["get", "ground"], 0, 1.2],
        "icon-halo-blur": 0,
        "icon-opacity": ["case", ["get", "dim"], 0.18, ["get", "stale"], 0.4, 1],
      };
      map.addLayer({ id: "world-planes", type: "symbol", source: "world", layout: planeLayout, paint: planePaint });
      map.addLayer({ id: "local-planes", type: "symbol", source: "local", layout: planeLayout, paint: planePaint });

      ready.current = true;
      tickLocal();
      tickWorld();
      if (wired) return;   // theme switch: handlers are still attached
      wired = true;

      for (const layer of ["world-planes", "local-planes"]) {
        map.on("click", layer, (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id;
          if (typeof id === "string") live.current.onSelect(id);
        });
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mousemove", layer, (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point") return;
          // setText, never setHTML: callsigns are untrusted.
          tip.setLngLat(f.geometry.coordinates as [number, number]).setText(String(f.properties?.label ?? "")).addTo(map);
        });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; tip.remove(); });
      }
      map.on("click", (e: MapLayerMouseEvent) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ["world-planes", "local-planes"] });
        if (!hit.length) live.current.onSelect(null);
      });

      live.current.onMapReady(map);
      reportView();
    });

    // Build features with dead-reckoned positions.
    const localSmooth = makeSmoother(LOCAL_BLEND_MS);
    const worldSmooth = makeSmoother(WORLD_BLEND_MS);
    const features = (list: Derived[], serverNow: number, cap: number, sm: ReturnType<typeof makeSmoother>,
                      opts: { skip?: string | null; prune?: boolean } = {}) => {
      const { selectedId, dimmed } = live.current;
      const out: Feature<Point>[] = [];
      let selectedPos: LatLon | null = null;
      const now = performance.now();
      const alive = new Set<string>();
      for (const d of list) {
        const est = estimate(d, serverNow, cap);
        if (!est) continue;
        const a = d.a;
        alive.add(a.icao24);
        const pos = sm.place(a.icao24, a.time_position, est, now);
        if (a.icao24 === opts.skip) continue; // drawn by the other source this frame
        const sel = a.icao24 === selectedId;
        if (sel) selectedPos = pos;
        out.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [pos[1], pos[0]] },
          properties: {
            id: a.icao24, rot: a.track_deg ?? 0, ground: a.on_ground, sel,
            dim: !!dimmed?.has(a.icao24),
            stale: a.last_contact != null && serverNow - a.last_contact > STALE_S,
            label: flightLabel(d),
          },
        });
      }
      if (opts.prune !== false) sm.prune(alive);
      return { out, selectedPos };
    };

    const setTrail = (head: LatLon | null) => {
      const src = map.getSource("trail") as GeoJSONSource | undefined;
      if (!src) return;
      const pts = [...live.current.trail, ...(head ? [head] : [])];
      src.setData(pts.length >= 2
        ? { type: "Feature", geometry: { type: "LineString", coordinates: pts.map(([la, lo]) => [lo, la]) }, properties: {} }
        : empty());
    };

    // Where the selected plane was drawn this frame (the camera follows this exact point).
    let selectedPos: LatLon | null = null;
    const selectedWorld = () => {
      const { aircraft, world, selectedId } = live.current;
      if (!selectedId || aircraft.some((d) => d.a.icao24 === selectedId)) return null;
      return world.find((d) => d.a.icao24 === selectedId) ?? null;
    };

    // Boston planes, plus the selected worldwide plane: it moves to this fast
    // source so it glides as smoothly as the camera that follows it.
    const tickLocal = () => {
      if (!ready.current) return;
      const { aircraft, clockSkew } = live.current;
      const serverNow = Date.now() / 1000 + clockSkew;
      const loc = features(aircraft, serverNow, MAX_EXTRAPOLATE_S, localSmooth);
      const selW = selectedWorld();
      const w = selW ? features([selW], serverNow, WORLD_EXTRAPOLATE_S, worldSmooth, { prune: false }) : null;
      // A source can be briefly missing while MapLibre rebuilds the style (e.g. after
      // the GPU context is lost); skip the frame rather than crash the page.
      (map.getSource("local") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [...loc.out, ...(w?.out ?? [])] } as FC);
      selectedPos = loc.selectedPos ?? w?.selectedPos ?? null;
      setTrail(loc.selectedPos);
    };
    const tickWorld = () => {
      if (!ready.current) return;
      const { world, clockSkew } = live.current;
      const serverNow = Date.now() / 1000 + clockSkew;
      const res = features(world, serverNow, WORLD_EXTRAPOLATE_S, worldSmooth, { skip: selectedWorld()?.a.icao24 });
      (map.getSource("world") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: res.out } as FC);
    };

    // Camera follow: fly in once, then re-centre on the plane every frame.
    let flyIn: { t0: number; from: [number, number]; z0: number; z1: number } | null = null;
    startFollow.current = () => {
      const c = map.getCenter();
      flyIn = { t0: performance.now(), from: [c.lng, c.lat], z0: map.getZoom(), z1: Math.min(13, Math.max(map.getZoom(), FOLLOW_ZOOM)) };
    };
    const following = () => live.current.follow && live.current.selectedId != null;
    const moveCamera = (t: number) => {
      if (!following() || !selectedPos) return;
      const [lat, lon] = selectedPos;
      const padding = freePadding(map);
      if (flyIn) {
        const k = easeInOut(Math.min(1, Math.max(0, (t - flyIn.t0) / FLY_IN_MS)));
        let dLon = lon - flyIn.from[0];
        if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
        map.jumpTo({
          center: [flyIn.from[0] + dLon * k, flyIn.from[1] + (lat - flyIn.from[1]) * k],
          zoom: flyIn.z0 + (flyIn.z1 - flyIn.z0) * k,
          padding,
        });
        if (k >= 1) flyIn = null;
      } else {
        map.jumpTo({ center: [lon, lat], padding });
      }
    };
    // Grabbing the map means you want to look around: stop following.
    map.on("dragstart", () => { flyIn = null; if (live.current.follow) live.current.onFollowChange(false); });
    redraw.current = () => { tickLocal(); tickWorld(); };
    // One animation loop. It pauses by itself when the tab is hidden.
    let frame = 0, lastLocal = 0, lastWorld = 0;
    const loop = (t: number) => {
      // While following, redraw every frame so the plane and camera move together.
      if (following() || t - lastLocal >= LOCAL_FRAME_MS) { lastLocal = t; tickLocal(); }
      if (t - lastWorld >= WORLD_FRAME_MS) { lastWorld = t; tickWorld(); }
      moveCamera(t);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // Report the visible area so the server sends worldwide aircraft for it.
    // Debounced: a pan fires many events; the server only needs the final view.
    // Following moves the map every frame, so also report at least every 1.5 s.
    let viewTimer: number | undefined;
    let lastReport = 0;
    function reportView() {
      window.clearTimeout(viewTimer);
      const send = () => { lastReport = performance.now(); const c = map.getCenter(); live.current.onViewChange?.(visibleBox(map), [c.lat, c.lng], map.getZoom()); };
      if (performance.now() - lastReport > VIEW_REPORT_MAX_MS) send();
      else viewTimer = window.setTimeout(send, 300);
    }
    map.on("moveend", reportView);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(viewTimer);
      ready.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Redraw immediately on new data or selection instead of waiting for the next tick.
  useEffect(() => {
    if (ready.current) redraw.current?.();
  }, [props.aircraft, props.world, props.selectedId, props.dimmed, props.trail]);

  // Theme switch: load the other basemap; "style.load" re-adds the aircraft layers.
  const firstTheme = useRef(props.theme);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || props.theme === firstTheme.current) return;
    firstTheme.current = props.theme;
    ready.current = false;
    map.setStyle(STYLES[props.theme], { diff: false });
  }, [props.theme]);

  // Clicking a plane (or turning follow back on) flies the camera to it.
  useEffect(() => {
    if (props.follow && props.selectedId) startFollow.current?.();
  }, [props.selectedId, props.follow]);

  return <div ref={divRef} className="map" />;
}
