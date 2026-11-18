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
}

export interface Snapshot {
  fetched_at: number;
  api_time: number;
  aircraft: Aircraft[];
}

export type LatLon = [number, number];
