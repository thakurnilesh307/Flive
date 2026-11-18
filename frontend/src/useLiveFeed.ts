import { useEffect, useRef, useState } from "react";
import type { LatLon, Snapshot } from "./types";

const TRAIL_POINTS = 120;      // ~10 min at one snapshot per 5 s
const FORGET_AFTER_S = 120;    // drop trails of aircraft gone this long

export interface Feed {
  snapshot: Snapshot | null;
  connected: boolean;
  /** server clock minus browser clock, seconds (for dead reckoning) */
  clockSkew: number;
  /** recent positions per icao24, oldest first */
  trails: React.MutableRefObject<Map<string, LatLon[]>>;
}

export function useLiveFeed(): Feed {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [clockSkew, setClockSkew] = useState(0);
  const trails = useRef(new Map<string, LatLon[]>());
  const lastSeen = useRef(new Map<string, number>());

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
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        try {
          const snap = JSON.parse(e.data) as Snapshot;
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
  }, []);

  return { snapshot, connected, clockSkew, trails };
}
