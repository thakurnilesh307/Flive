import type { Derived } from "./status";

const n = (v: number) => Math.round(v).toLocaleString("en-US");

export const flightLabel = (d: Derived) => d.a.callsign ?? d.a.registration ?? d.a.icao24.toUpperCase();

export function fmtAlt(d: Derived): string {
  if (d.a.on_ground) return "Ground";
  if (d.altFt == null) return "–";
  return `${n(Math.round(d.altFt / 25) * 25)} ft`;
}

export const fmtSpeed = (d: Derived) => (d.gsKt == null ? "–" : `${n(d.gsKt)} kt`);

export function fmtHeading(d: Derived): string {
  const t = d.a.track_deg;
  return t == null ? "–" : `${String(Math.round(t) % 360).padStart(3, "0")}°`;
}

export function fmtVs(d: Derived): string {
  if (d.a.on_ground || d.vsFpm == null) return "–";
  const v = Math.round(d.vsFpm / 10) * 10;
  if (v === 0) return "0 fpm";
  return `${v < 0 ? "−" : "+"}${n(Math.abs(v))} fpm`;
}

export const fmtDist = (d: Derived) =>
  d.distNm == null ? "–" : d.distNm >= 100 ? `${n(d.distNm)} nm` : `${d.distNm.toFixed(1)} nm`;

export function fmtAgo(seconds: number): string {
  if (seconds < 1) return "just now";
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

/** Clock in the viewer's own time zone (it's a worldwide map now). */
export const localTime = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });

/** Minutes until a unix time, never below 0. */
export const minsUntil = (t: number, serverNow: number) => Math.max(0, Math.round((t - serverNow) / 60));

/** Clock time of a unix timestamp in the viewer's zone, e.g. "6:42 AM". */
export const clockAt = (t: number) =>
  new Date(t * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
