import type { Aircraft } from "./types";
import { KBOS, M_TO_FT, MS_TO_FPM, MS_TO_KT, angleDiff, bearingDeg, distanceNm } from "./geo";

export type FlightStatus = "approach" | "inbound" | "departing" | "enroute" | "taxiing" | "ground";

export const STATUS_LABEL: Record<FlightStatus, string> = {
  approach: "On approach",
  inbound: "Inbound",
  departing: "Departing",
  enroute: "En route",
  taxiing: "Taxiing",
  ground: "On ground",
};

/** An aircraft plus the display values and status we derive from it. */
export interface Derived {
  a: Aircraft;
  distNm: number | null;
  altFt: number | null;
  gsKt: number | null;
  vsFpm: number | null;
  status: FlightStatus;
}

/**
 * Rough status from position, track and vertical rate alone. This is a
 * placeholder until real arrival/departure detection (roadmap step 4): it can
 * be fooled by traffic for nearby airports (Hanscom, Norwood, Beverly).
 */
function classify(a: Aircraft, dist: number | null, alt: number | null, gs: number | null, vs: number | null): FlightStatus {
  if (a.on_ground) return gs != null && gs > 5 ? "taxiing" : "ground";
  if (dist == null) return "enroute";

  const brgToBos = a.lat != null && a.lon != null ? bearingDeg([a.lat, a.lon], KBOS) : null;
  const off = a.track_deg != null && brgToBos != null ? angleDiff(a.track_deg, brgToBos) : null;
  const toward = off != null && off < 45;
  const away = off != null && off > 120;
  const descending = vs != null && vs < -250;
  const climbing = vs != null && vs > 250;

  if (dist < 15 && alt != null && alt < 5000 && toward && (descending || alt < 2000)) return "approach";
  if (dist < 40 && descending && toward && (alt == null || alt < 18000)) return "inbound";
  if (dist < 25 && climbing && (away || dist < 5)) return "departing";
  return "enroute";
}

export function derive(a: Aircraft): Derived {
  const distNm = a.lat != null && a.lon != null ? distanceNm([a.lat, a.lon], KBOS) : null;
  const altFt = a.on_ground || a.baro_alt_m == null ? null : a.baro_alt_m * M_TO_FT;
  const gsKt = a.velocity_ms == null ? null : a.velocity_ms * MS_TO_KT;
  const vsFpm = a.vert_rate_ms == null ? null : a.vert_rate_ms * MS_TO_FPM;
  return { a, distNm, altFt, gsKt, vsFpm, status: classify(a, distNm, altFt, gsKt, vsFpm) };
}

export const isArriving = (s: FlightStatus) => s === "approach" || s === "inbound";
