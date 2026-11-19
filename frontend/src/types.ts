// Mirrors the server snapshot format (see CLAUDE.md). SI units throughout.
export interface Aircraft {
  icao24: string;
  callsign: string | null;
  lat: number | null;
  lon: number | null;
  baro_alt_m: number | null;
  on_ground: boolean;
  velocity_ms: number | null;
  track_deg: number | null;
  vert_rate_ms: number | null;
  geo_alt_m: number | null;
  squawk: string | null;
  time_position: number | null;
  last_contact: number | null;
  pos_source: number | null;
  category: number | null;
  aircraft_type: string | null;
  registration: string | null;
  /** who the flight is operating as, from the server's airline list (callsign prefix) */
  operator?: string | null;
  /** that operator's ICAO code (for the logo), e.g. "JBU" even when the callsign is a tail number */
  operator_icao?: string | null;
  /** altitude corrected for local air pressure from the nearest METAR (see weather.py) */
  alt_qnh_m?: number | null;
  /** set by the page: which airport feed this came from (KBOS = the main Boston feed) */
  airport?: string;
  /** predicted touchdown (unix s) at that airport from the landing-time model, plus the likely range */
  landing_at?: number | null;
  landing_lo_at?: number | null;
  landing_hi_at?: number | null;
  /** worldwide planes: "global" when the rough global model made the prediction, and for which airport */
  prediction?: "global" | null;
  landing_airport?: string | null;
  /** predicted runway (runway models) and the model's probability, 0-1 */
  landing_runway?: string | null;
  landing_runway_p?: number | null;
  takeoff_runway?: string | null;
  takeoff_runway_p?: number | null;
  /** full model name from the aircraft database, e.g. "Boeing 737-800" */
  type_desc?: string | null;
}

export interface Snapshot {
  fetched_at: number;
  api_time: number;
  aircraft: Aircraft[];
}

export type LatLon = [number, number];

/** Worldwide aircraft in the current map view (OpenSky, slower updates). */
export interface WorldView {
  apiTime: number | null;
  nextUpdateS: number;
  totalInView: number;
  aircraft: Aircraft[];
}

/** Another prediction airport's own 10 s feed (JFK, Heathrow), sent while it's in view. */
export interface AirportFeed {
  icao: string;
  name: string;
  pos: LatLon;
  apiTime: number;
  receivedAt: number;
  runwayInUse: string | null;
  aircraft: Aircraft[];
}

/** [west, south, east, north] in degrees; east >= west (may exceed ±180 when the map wraps). */
export type BBox = [number, number, number, number];
