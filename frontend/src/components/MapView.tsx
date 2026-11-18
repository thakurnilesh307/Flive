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
  onViewChange?: (bbox: BBox) => void;
}

const STALE_S = 30;              // fade aircraft we haven't heard from in this long
const MAX_EXTRAPOLATE_S = 20;    // Boston: never dead-reckon further than this
const WORLD_EXTRAPOLATE_S = 120; // world updates are ~90 s apart; cap the glide a bit beyond that
const LOCAL_TICK_MS = 500;
const WORLD_TICK_MS = 1000;
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
type FC = FeatureCollection<Geometry>;

function estimate(d: Derived, serverNow: number, cap: number): LatLon | null {
  const a = d.a;
  if (a.lat == null || a.lon == null) return null;
  if (a.on_ground || a.velocity_ms == null || a.track_deg == null || a.time_position == null) {
    return [a.lat, a.lon];
  }
  const dt = Math.min(cap, Math.max(0, serverNow - a.time_position));
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

export default function MapView(props: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GLMap | null>(null);
  const ready = useRef(false);
  const redraw = useRef<(() => void) | null>(null);

  // Latest props for timers and MapLibre callbacks.
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const map = new GLMap({
      container: divRef.current!,
      style: STYLE_URL,
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

    map.on("style.load", () => {
      restyleBasemap(map);
      map.setProjection({ type: "globe" });   // globe when zoomed out, flat map when zoomed in
      if (!map.hasImage("plane")) map.addImage("plane", planeImage(), { sdf: true, pixelRatio: 2 });

      map.addSource("trail", { type: "geojson", data: empty() });
      map.addSource("world", { type: "geojson", data: empty() });
      map.addSource("local", { type: "geojson", data: empty() });

      map.addLayer({
        id: "trail", type: "line", source: "trail",
        paint: { "line-color": "#4da3ff", "line-width": 2.5, "line-dasharray": [1.5, 2.5], "line-opacity": 0.9 },
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
        "icon-color": ["case", ["get", "sel"], "#cfe8ff", ["get", "ground"], "#7b8ba6", "#5aa8ff"],
        "icon-halo-color": ["case", ["get", "sel"], "rgba(61,139,255,0.95)", "rgba(61,139,255,0.45)"],
        "icon-halo-width": ["case", ["get", "sel"], 3, ["get", "ground"], 0, 1.2],
        "icon-halo-blur": ["case", ["get", "sel"], 2.5, 1.5],
        "icon-opacity": ["case", ["get", "dim"], 0.18, ["get", "stale"], 0.4, 1],
      };
      map.addLayer({ id: "world-planes", type: "symbol", source: "world", layout: planeLayout, paint: planePaint });
      map.addLayer({ id: "local-planes", type: "symbol", source: "local", layout: planeLayout, paint: planePaint });

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

      ready.current = true;
      tickLocal();
      tickWorld();
      live.current.onMapReady(map);
      reportView();
    });

    // Build features with dead-reckoned positions.
    const features = (list: Derived[], serverNow: number, cap: number, keepTrail: boolean) => {
      const { selectedId, dimmed } = live.current;
      const out: Feature<Point>[] = [];
      let selectedPos: LatLon | null = null;
      for (const d of list) {
        const pos = estimate(d, serverNow, cap);
        if (!pos) continue;
        const a = d.a;
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
      if (keepTrail && selectedPos) setTrail(selectedPos);
      return { type: "FeatureCollection", features: out } as FC;
    };

    const setTrail = (head: LatLon | null) => {
      const src = map.getSource("trail") as GeoJSONSource | undefined;
      if (!src) return;
      const pts = [...live.current.trail, ...(head ? [head] : [])];
      src.setData(pts.length >= 2
        ? { type: "Feature", geometry: { type: "LineString", coordinates: pts.map(([la, lo]) => [lo, la]) }, properties: {} }
        : empty());
    };

    const tickLocal = () => {
      if (!ready.current) return;
      const { aircraft, clockSkew, selectedId } = live.current;
      const serverNow = Date.now() / 1000 + clockSkew;
      (map.getSource("local") as GeoJSONSource).setData(features(aircraft, serverNow, MAX_EXTRAPOLATE_S, true));
      if (!selectedId || !aircraft.some((d) => d.a.icao24 === selectedId)) setTrail(null);
    };
    const tickWorld = () => {
      if (!ready.current) return;
      const { world, clockSkew } = live.current;
      const serverNow = Date.now() / 1000 + clockSkew;
      (map.getSource("world") as GeoJSONSource).setData(features(world, serverNow, WORLD_EXTRAPOLATE_S, false));
    };
    redraw.current = () => { tickLocal(); tickWorld(); };
    const localTimer = window.setInterval(tickLocal, LOCAL_TICK_MS);
    const worldTimer = window.setInterval(tickWorld, WORLD_TICK_MS);

    // Report the visible area so the server sends worldwide aircraft for it.
    // Debounced: a pan fires many events; the server only needs the final view.
    let viewTimer: number | undefined;
    function reportView() {
      window.clearTimeout(viewTimer);
      viewTimer = window.setTimeout(() => {
        live.current.onViewChange?.(visibleBox(map));
      }, 300);
    }
    map.on("moveend", reportView);

    return () => {
      window.clearInterval(localTimer);
      window.clearInterval(worldTimer);
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

  return <div ref={divRef} className="map" />;
}
