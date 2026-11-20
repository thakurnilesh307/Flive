import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Aircraft, AirportFeed, BBox, LatLon, Snapshot, WorldView } from "./types";

/** Expand a compact world row (array + field list) into a full Aircraft object. */
const str = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : null);

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
    aircraft_type: str(o.aircraft_type, 4), registration: str(o.registration, 10),
    operator: str(o.operator, 40), operator_icao: str(o.operator_icao, 3),
    alt_qnh_m: typeof o.alt_qnh_m === "number" ? o.alt_qnh_m : null,
    landing_at: typeof o.landing_at === "number" ? o.landing_at : null,
    landing_lo_at: typeof o.landing_lo_at === "number" ? o.landing_lo_at : null,
    landing_hi_at: typeof o.landing_hi_at === "number" ? o.landing_hi_at : null,
    landing_airport: typeof o.landing_airport === "string" && /^[A-Z0-9]{3,4}$/.test(o.landing_airport) ? o.landing_airport : null,
    landing_runway: typeof o.landing_runway === "string" ? o.landing_runway.slice(0, 4) : null,
    prediction: typeof o.landing_at === "number" ? "global" : null,
  };
}

/** Fields a fast "track" update replaces; everything else (operator, predictions) is kept. */
const TRACK_FIELDS = ["lat", "lon", "on_ground", "velocity_ms", "track_deg", "vert_rate_ms", "baro_alt_m",
  "geo_alt_m", "alt_qnh_m", "time_position", "last_contact"] as const;

/** `list` with the plane `fix` describes updated in place, or null if it isn't there or `fix` is older. */
function applyTrack(list: Aircraft[], fix: Aircraft): Aircraft[] | null {
  const i = list.findIndex((a) => a.icao24 === fix.icao24);
  if (i < 0) return null;
  const old = list[i];
  if (fix.time_position == null || (old.time_position != null && fix.time_position <= old.time_position)) return null;
  const merged: Aircraft = { ...old };
  for (const k of TRACK_FIELDS) (merged as unknown as Record<string, unknown>)[k] = fix[k] ?? null;
  const out = list.slice();
  out[i] = merged;
  return out;
}

const TRAIL_POINTS = 120;      // ~10 min at one snapshot per 5 s
const FORGET_AFTER_S = 120;    // drop trails of aircraft gone this long
const AIRPORT_FEED_MAX_AGE_S = 30;   // the server stops sending once the airport leaves the view

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
  /** aircraft the server should always include in world data (the selected one), or null */
  keepAircraft: (icao24: string | null) => void;
  /** other prediction airports' own feeds (JFK, Heathrow) while they're in view */
  airportFeeds: AirportFeed[];
  /** the plane being followed (or null): the server sends it ~every 2 s instead of 5-10 s */
  followAircraft: (icao24: string | null) => void;
}

export function useLiveFeed(): Feed {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [clockSkew, setClockSkew] = useState(0);
  const trails = useRef(new Map<string, LatLon[]>());
  const lastSeen = useRef(new Map<string, number>());
  const [world, setWorld] = useState<WorldView | null>(null);
  const [airportFeeds, setAirportFeeds] = useState<Record<string, AirportFeed>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const viewRef = useRef<BBox | null>(null);

  const keepRef = useRef<string | null>(null);
  const followRef = useRef<string | null>(null);
  const fixRef = useRef<Aircraft | null>(null);   // newest fast fix for the followed plane
  /** Slower feeds can carry an older position for the followed plane: keep the newer fix. */
  const keepNewest = (list: Aircraft[]) => (fixRef.current && applyTrack(list, fixRef.current)) || list;

  const sendFollow = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "follow", icao24: followRef.current }));
  }, []);

  const followAircraft = useCallback((icao24: string | null) => {
    if (followRef.current === icao24) return;
    followRef.current = icao24;
    fixRef.current = null;
    sendFollow();
  }, [sendFollow]);

  const sendView = useCallback((bbox: BBox) => {
    viewRef.current = bbox;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "view",
        bbox: bbox.map((v) => Math.round(v * 1000) / 1000),
        ...(keepRef.current ? { keep: [keepRef.current] } : {}),
      }));
    }
  }, []);

  const keepAircraft = useCallback((icao24: string | null) => {
    if (keepRef.current === icao24) return;
    keepRef.current = icao24;
    if (viewRef.current) sendView(viewRef.current);
  }, [sendView]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    let stopped = false;

    const addTrails = (aircraft: Aircraft[], now: number) => {
      for (const a of aircraft) {
        if (a.lat == null || a.lon == null) continue;
        lastSeen.current.set(a.icao24, now);
        const t = trails.current.get(a.icao24) ?? [];
        const last = t[t.length - 1];
        if (!last || last[0] !== a.lat || last[1] !== a.lon) t.push([a.lat, a.lon]);
        if (t.length > TRAIL_POINTS) t.splice(0, t.length - TRAIL_POINTS);
        trails.current.set(a.icao24, t);
      }
    };

    const onSnapshot = (snap: Snapshot) => {
      const now = snap.api_time;
      addTrails(snap.aircraft, now);
      for (const [id, seen] of lastSeen.current) {
        if (now - seen > FORGET_AFTER_S) {
          lastSeen.current.delete(id);
          trails.current.delete(id);
        }
      }
      setClockSkew(snap.api_time - Date.now() / 1000);
      setSnapshot({ ...snap, aircraft: keepNewest(snap.aircraft) });
    };

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        if (viewRef.current) sendView(viewRef.current);
        if (followRef.current) sendFollow();
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg?.type === "world") {
            if (!Array.isArray(msg.fields) || !Array.isArray(msg.aircraft)) return;
            const aircraft = keepNewest((msg.aircraft as unknown[])
              .map((r) => (Array.isArray(r) ? decodeRow(msg.fields, r) : null))
              .filter((a): a is Aircraft => a != null));
            setWorld({
              apiTime: typeof msg.api_time === "number" ? msg.api_time : null,
              nextUpdateS: typeof msg.next_update_s === "number" ? msg.next_update_s : 90,
              totalInView: typeof msg.total_in_view === "number" ? msg.total_in_view : aircraft.length,
              aircraft,
            });
            return;
          }
          if (msg?.type === "track") {
            // Fast update for the followed plane: patch it wherever it's shown.
            const fix = msg.aircraft as Aircraft;
            if (!fix || typeof fix.icao24 !== "string" || fix.icao24 !== msg.icao24
              || typeof fix.lat !== "number" || typeof fix.lon !== "number") return;
            if (fix.icao24 !== followRef.current) return;   // a late message after switching planes
            if (!fixRef.current || (fix.time_position ?? 0) > (fixRef.current.time_position ?? 0)) fixRef.current = fix;
            addTrails([fix], typeof msg.api_time === "number" ? msg.api_time : Date.now() / 1000);
            setSnapshot((snap) => {
              const list = snap && applyTrack(snap.aircraft, fix);
              return list ? { ...snap!, aircraft: list } : snap;
            });
            setAirportFeeds((f) => {
              for (const [icao, feed] of Object.entries(f)) {
                const list = applyTrack(feed.aircraft, fix);
                if (list) return { ...f, [icao]: { ...feed, aircraft: list } };
              }
              return f;
            });
            setWorld((w) => {
              const list = w && applyTrack(w.aircraft, fix);
              return list ? { ...w!, aircraft: list } : w;
            });
            return;
          }
          if (msg?.type === "airport") {
            if (typeof msg.icao !== "string" || !/^[A-Z]{4}$/.test(msg.icao) || !Array.isArray(msg.aircraft)
              || typeof msg.lat !== "number" || typeof msg.lon !== "number" || typeof msg.api_time !== "number") return;
            const icao: string = msg.icao;
            const aircraft = keepNewest((msg.aircraft as Aircraft[])
              .filter((a) => a && typeof a.icao24 === "string")
              .map((a) => ({ ...a, airport: icao })));
            addTrails(aircraft, msg.api_time);
            const feed: AirportFeed = {
              icao,
              name: typeof msg.name === "string" ? msg.name.slice(0, 30) : icao,
              pos: [msg.lat, msg.lon],
              apiTime: msg.api_time,
              receivedAt: Date.now() / 1000,
              runwayInUse: typeof msg.runway_in_use === "string" ? msg.runway_in_use.slice(0, 4) : null,
              aircraft,
            };
            setAirportFeeds((f) => ({ ...f, [icao]: feed }));
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
    // Drop airport feeds the server stopped sending (map moved away, or disconnected).
    const sweep = window.setInterval(() => {
      const cutoff = Date.now() / 1000 - AIRPORT_FEED_MAX_AGE_S;
      setAirportFeeds((f) => (Object.values(f).some((x) => x.receivedAt < cutoff)
        ? Object.fromEntries(Object.entries(f).filter(([, x]) => x.receivedAt >= cutoff)) : f));
    }, 5000);
    return () => {
      stopped = true;
      window.clearInterval(sweep);
      window.clearTimeout(retry);
      ws?.close();
    };
  }, [sendView, sendFollow]);

  const feeds = useMemo(() => Object.values(airportFeeds), [airportFeeds]);
  return { snapshot, connected, clockSkew, trails, world, sendView, keepAircraft, airportFeeds: feeds, followAircraft };
}
