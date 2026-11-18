import { useEffect, useState } from "react";
import type { Aircraft, LatLon } from "./types";
import { bearingDeg, distanceNm } from "./geo";

/**
 * "12 nm NE of JFK" for any plane, from the server's airport list (OurAirports,
 * 3,265 airports with scheduled service, GET /api/airports, fetched once).
 */
export interface Airport { code: string; iata: string; icao: string; lat: number; lon: number; name: string; city: string }

const CELL = 5; // degrees
let grid: Map<string, Airport[]> | null = null;
let all: Airport[] = [];
let loading: Promise<void> | null = null;
const key = (lat: number, lon: number) => `${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`;

function load(): Promise<void> {
  loading ??= fetch("/api/airports?v=2") // bump v when the row format changes (responses are cached a day)
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: unknown) => {
      const g = new Map<string, Airport[]>();
      const txt = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
      all = (Array.isArray(rows) ? rows : [])
        .filter((r): r is unknown[] => Array.isArray(r) && typeof r[2] === "number" && typeof r[3] === "number")
        .map((r) => {
          const iata = txt(r[0], 3), icao = txt(r[1], 4);
          return { code: iata || icao, iata, icao, lat: r[2] as number, lon: r[3] as number, name: txt(r[4], 80), city: txt(r[5], 60) };
        })
        .filter((a) => a.code);
      for (const a of all) {
        const k = key(a.lat, a.lon);
        if (!g.has(k)) g.set(k, []);
        g.get(k)!.push(a);
      }
      grid = g;
    })
    .catch(() => { loading = null; });
  return loading;
}

/** Re-renders the caller once the airport list has arrived. */
export function useAirports(): boolean {
  const [ready, setReady] = useState(grid != null);
  useEffect(() => { if (!ready) load().then(() => setReady(grid != null)); }, [ready]);
  return ready;
}

export function nearest(p: LatLon): { a: Airport; dist: number } | null {
  if (!grid) return null;
  const cy = Math.floor(p[0] / CELL), cx = Math.floor(p[1] / CELL);
  let best: { a: Airport; dist: number } | null = null;
  // Look in the 3x3 cells around the point; over oceans fall back to every airport.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const lonCell = ((((cx + dx + 36) % 72) + 72) % 72) - 36; // wrap across ±180 (cells -36..35)
      for (const a of grid.get(`${cy + dy},${lonCell}`) ?? []) {
        const dist = distanceNm(p, [a.lat, a.lon]);
        if (!best || dist < best.dist) best = { a, dist };
      }
    }
  }
  if (best && best.dist <= CELL * 60) return best;
  for (const a of all) {
    const dist = distanceNm(p, [a.lat, a.lon]);
    if (!best || dist < best.dist) best = { a, dist };
  }
  return best;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** "at BOS", "12 nm NE of JFK", or null while the airport list loads. */
export function describePosition(a: Aircraft): string | null {
  if (a.lat == null || a.lon == null) return null;
  const hit = nearest([a.lat, a.lon]);
  if (!hit) return null;
  if (hit.dist < 3) return `at ${hit.a.code}`;
  const dir = COMPASS[Math.round(bearingDeg([hit.a.lat, hit.a.lon], [a.lat, a.lon]) / 45) % 8];
  const nm = hit.dist >= 100 ? Math.round(hit.dist).toLocaleString("en-US") : Math.round(hit.dist);
  return `${nm} nm ${dir} of ${hit.a.code}`;
}

/** Airports matching a search: exact IATA/ICAO code first, then name or city. */
export function searchAirports(query: string, limit = 5): Airport[] {
  const q = query.trim().toUpperCase();
  if (!grid || q.length < 3) return [];
  const exact = all.filter((a) => a.iata === q || a.icao === q);
  const text = all.filter((a) => !exact.includes(a) &&
    (a.name.toUpperCase().includes(q) || a.city.toUpperCase().startsWith(q)));
  return [...exact, ...text].slice(0, limit);
}
