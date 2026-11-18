import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

// After bundling, MapLibre can't find its worker next to our JS; tell it where Vite put it.
setWorkerUrl(maplibreWorkerUrl);
import type { Derived } from "../status";
import type { LatLon } from "../types";
import { KBOS, MS_TO_KT, project } from "../geo";
import { flightLabel } from "../format";
import { PLANE_PATH } from "./icons";
import { restyleBasemap } from "../basemap";

interface Props {
  aircraft: Derived[];
  selectedId: string | null;
  /** ids hidden by the search filter (dimmed on the map), or null for none */
  dimmed: Set<string> | null;
  trail: LatLon[];
  clockSkew: number;
  onSelect: (id: string | null) => void;
  onMapReady: (map: L.Map) => void;
}

const STALE_S = 30;           // fade aircraft we haven't heard from in this long
const MAX_EXTRAPOLATE_S = 20; // never dead-reckon further than this
const TICK_MS = 500;

// Static markup only: no provider data is ever put into HTML strings.
const ICON_HTML = `<div class="ac-rot"><svg viewBox="0 0 24 24"><path d="${PLANE_PATH}"/></svg></div>`;
const KBOS_HTML = `<div class="kbos-dot"></div><div class="kbos-label">KBOS</div>`;

function estimate(d: Derived, serverNow: number): LatLon | null {
  const a = d.a;
  if (a.lat == null || a.lon == null) return null;
  if (a.on_ground || a.velocity_ms == null || a.track_deg == null || a.time_position == null) {
    return [a.lat, a.lon];
  }
  const dt = Math.min(MAX_EXTRAPOLATE_S, Math.max(0, serverNow - a.time_position));
  return project([a.lat, a.lon], a.track_deg, a.velocity_ms * MS_TO_KT, dt);
}

export default function MapView({ aircraft, selectedId, dimmed, trail, clockSkew, onSelect, onMapReady }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const trailLine = useRef<L.Polyline | null>(null);

  // Latest props for the animation timer and Leaflet callbacks.
  const live = useRef({ aircraft, selectedId, trail, clockSkew, onSelect });
  live.current = { aircraft, selectedId, trail, clockSkew, onSelect };

  // Create the map once.
  useEffect(() => {
    const map = L.map(divRef.current!, {
      center: KBOS, zoom: 10, minZoom: 7, maxZoom: 15, zoomControl: false,
      attributionControl: false, // credits are rendered by App, below the flight list
    });
    // Vector basemap: OpenFreeMap is free with no API key (CARTO now needs one).
    const gl = maplibreGL({ style: "https://tiles.openfreemap.org/styles/dark" }).addTo(map);
    const glMap = gl.getMaplibreMap();
    glMap.on("style.load", () => restyleBasemap(glMap));
    L.marker(KBOS, {
      icon: L.divIcon({ className: "kbos-marker", html: KBOS_HTML, iconSize: [0, 0] }),
      interactive: false, keyboard: false,
    }).addTo(map);
    map.on("click", () => live.current.onSelect(null));
    mapRef.current = map;
    onMapReady(map);

    // Dead reckoning: glide markers between 5 s updates.
    const timer = window.setInterval(() => {
      const { aircraft, selectedId, trail, clockSkew } = live.current;
      const serverNow = Date.now() / 1000 + clockSkew;
      let selectedPos: LatLon | null = null;
      for (const d of aircraft) {
        const m = markers.current.get(d.a.icao24);
        const pos = estimate(d, serverNow);
        if (!m || !pos) continue;
        m.setLatLng(pos);
        if (d.a.icao24 === selectedId) selectedPos = pos;
        m.getElement()?.classList.toggle(
          "stale", d.a.last_contact != null && serverNow - d.a.last_contact > STALE_S,
        );
      }
      if (trailLine.current) {
        trailLine.current.setLatLngs(selectedPos ? [...trail, selectedPos] : trail);
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(timer);
      map.remove();
      mapRef.current = null;
      markers.current.clear();
      trailLine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync markers with the latest snapshot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const present = new Set<string>();
    for (const d of aircraft) {
      const a = d.a;
      if (a.lat == null || a.lon == null) continue;
      present.add(a.icao24);
      let m = markers.current.get(a.icao24);
      if (!m) {
        const id = a.icao24;
        m = L.marker([a.lat, a.lon], {
          icon: L.divIcon({ className: "ac-marker", html: ICON_HTML, iconSize: [28, 28], iconAnchor: [14, 14] }),
          keyboard: false,
        });
        const tip = document.createElement("div");
        m.bindTooltip(tip, { direction: "top", offset: [0, -14], className: "ac-tip" });
        m.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          live.current.onSelect(id);
        });
        m.addTo(map);
        markers.current.set(id, m);
      }
      // textContent, never innerHTML: callsigns are untrusted.
      const tip = m.getTooltip()?.getContent();
      if (tip instanceof HTMLElement) tip.textContent = flightLabel(d);
      const selected = a.icao24 === selectedId;
      m.setZIndexOffset(selected ? 1000 : a.on_ground ? -100 : 0);
      const el = m.getElement();
      if (el) {
        el.style.setProperty("--rot", `${a.track_deg ?? 0}deg`);
        el.classList.toggle("ground", a.on_ground);
        el.classList.toggle("selected", selected);
        el.classList.toggle("dim", !!dimmed?.has(a.icao24));
      }
    }
    for (const [id, m] of markers.current) {
      if (!present.has(id)) {
        m.remove();
        markers.current.delete(id);
      }
    }
  }, [aircraft, selectedId, dimmed]);

  // Dashed trail behind the selected aircraft.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selectedId) {
      trailLine.current?.remove();
      trailLine.current = null;
      return;
    }
    if (!trailLine.current) {
      trailLine.current = L.polyline([], {
        className: "ac-trail", color: "#4da3ff", weight: 2.5, dashArray: "4 7", opacity: 0.9, interactive: false,
      }).addTo(map);
    }
    trailLine.current.setLatLngs(trail);
  }, [selectedId, trail]);

  return <div ref={divRef} className="map" />;
}
