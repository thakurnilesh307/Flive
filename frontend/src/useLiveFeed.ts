import { useCallback, useEffect, useRef, useState } from "react";
import type { Aircraft, BBox, LatLon, Snapshot, WorldView } from "./types";

/** Expand a compact world row (array + field list) into a full Aircraft object. */
function decodeRow(fields: string[], row: unknown[]): Aircraft | null {
  const o: Record<string, unknown> = {};
  fields.forEach((f, i) => { o[f] = row[i] ?? null; });
  if (typeof o.icao24 !== "string" || typeof o.lat !== "number" || typeof o.lon !== "number") return null;
  return {
    icao24: o.icao24, callsign: typeof o.callsign === "string" ? o.callsign : null,
    lat: o.lat, lon: o.lon,
    baro_alt_m: typeof o.baro_alt_m === "number" ? o.baro_alt_m : null,
    on_ground: o.on_ground === 1 || o.on_ground === true,
    velocity_ms: typeof o.velocity_ms === "number" ? o.velocity_ms : null,
    track_deg: typeof o.track_deg === "number" ? o.track_deg : null,
    vert_rate_ms: typeof o.vert_rate_ms === "number" ? o.vert_rate_ms : null,
    time_position: typeof o.time_position === "number" ? o.time_position : null,
    category: typeof o.category === "number" ? o.category : null,
    geo_alt_m: null, squawk: null, last_contact: null, pos_source: null,
    aircraft_type: null, registration: null,
  };
}

const TRAIL_POINTS = 120;      // ~10 min at one snapshot per 5 s
const FORGET_AFTER_S = 120;    // drop trails of aircraft gone this long

export interface Feed {
  snapshot: Snapshot | null;
  connected: boolean;
  /** server clock minus browser clock, seconds (for dead reckoning) */
  clockSkew: number;
  /** recent positions per icao24, oldest first */
  trails: React.MutableRefObject<Map<string, LatLon[]>>;
  /** worldwide aircraft in the current view (null until a view is sent and the server has data) */
  world: WorldView | null;
  /** tell the server what the map shows; re-sent automatically after reconnects */
  sendView: (bbox: BBox) => void;
}

export function useLiveFeed(): Feed {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [clockSkew, setClockSkew] = useState(0);
  const trails = useRef(new Map<string, LatLon[]>());
  const lastSeen = useRef(new Map<string, number>());
  const [world, setWorld] = useState<WorldView | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const viewRef = useRef<BBox | null>(null);

  const sendView = useCallback((bbox: BBox) => {
    viewRef.current = bbox;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "view", bbox: bbox.map((v) => Math.round(v * 1000) / 1000) }));
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    let stopped = false;

    const onSnapshot = (snap: Snapshot) => {
      const now = snap.api_time;
      for (const a of snap.aircraft) {
        if (a.lat == null || a.lon == null) continue;
        lastSeen.current.set(a.icao24, now);
        const t = trails.current.get(a.icao24) ?? [];
        const last = t[t.length - 1];
        if (!last || last[0] !== a.lat || last[1] !== a.lon) t.push([a.lat, a.lon]);
        if (t.length > TRAIL_POINTS) t.splice(0, t.length - TRAIL_POINTS);
        trails.current.set(a.icao24, t);
      }
      for (const [id, seen] of lastSeen.current) {
        if (now - seen > FORGET_AFTER_S) {
          lastSeen.current.delete(id);
          trails.current.delete(id);
        }
      }
      setClockSkew(snap.api_time - Date.now() / 1000);
      setSnapshot(snap);
    };

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        if (viewRef.current) sendView(viewRef.current);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg?.type === "world") {
            if (!Array.isArray(msg.fields) || !Array.isArray(msg.aircraft)) return;
            const aircraft = (msg.aircraft as unknown[])
              .map((r) => (Array.isArray(r) ? decodeRow(msg.fields, r) : null))
              .filter((a): a is Aircraft => a != null);
            setWorld({
              apiTime: typeof msg.api_time === "number" ? msg.api_time : null,
              nextUpdateS: typeof msg.next_update_s === "number" ? msg.next_update_s : 90,
              totalInView: typeof msg.total_in_view === "number" ? msg.total_in_view : aircraft.length,
              aircraft,
            });
            return;
          }
          if (msg?.type) return;   // unknown future message types
          const snap = msg as Snapshot;
          if (snap && Array.isArray(snap.aircraft)) {
            snap.aircraft = snap.aircraft.filter((a) => a && typeof a.icao24 === "string");
            onSnapshot(snap);
          }
        } catch {
          /* ignore malformed messages */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = window.setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      ws?.close();
    };
  }, [sendView]);

  return { snapshot, connected, clockSkew, trails, world, sendView };
}
