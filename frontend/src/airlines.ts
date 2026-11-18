// ICAO airline designators commonly seen at Boston Logan. Lookup only; callsigns
// that don't match fall back to "General aviation" or "Unknown operator".
const AIRLINES: Record<string, string> = {
  AAL: "American Airlines", ABX: "ABX Air", ACA: "Air Canada", AFR: "Air France",
  AMX: "Aeroméxico", ASA: "Alaska Airlines", AAY: "Allegiant Air", AVA: "Avianca",
  BAW: "British Airways", CKS: "Kalitta Air", CMP: "Copa Airlines", CPA: "Cathay Pacific",
  CPZ: "Compass Airlines", DAL: "Delta Air Lines", DLH: "Lufthansa", EDV: "Endeavor Air",
  EIN: "Aer Lingus", EJA: "NetJets", ELY: "El Al", ENY: "Envoy Air", ETD: "Etihad Airways",
  FDX: "FedEx", FFT: "Frontier Airlines", GJS: "GoJet Airlines", GTI: "Atlas Air",
  IBE: "Iberia", ICE: "Icelandair", ITY: "ITA Airways", JAL: "Japan Airlines",
  JBU: "JetBlue", JIA: "PSA Airlines", JZA: "Air Canada Jazz", KAL: "Korean Air",
  KAP: "Cape Air", KLM: "KLM", LXJ: "Flexjet", NKS: "Spirit Airlines", PDT: "Piedmont Airlines",
  POE: "Porter Airlines", QTR: "Qatar Airways", RPA: "Republic Airways", SAS: "SAS",
  SCX: "Sun Country", SKW: "SkyWest Airlines", SWA: "Southwest Airlines", SWR: "Swiss",
  TAP: "TAP Air Portugal", THY: "Turkish Airlines", TSC: "Air Transat", UAE: "Emirates",
  UAL: "United Airlines", UPS: "UPS Airlines", VIR: "Virgin Atlantic", WJA: "WestJet",
};

export interface Operator {
  code: string;  // short code for the badge
  name: string;
}

/**
 * `known` is the server's answer (aircraft_db.operator_name, ~5,800 airlines
 * worldwide); the small table above is only the fallback when it's missing.
 */
export function operatorFor(callsign: string | null, registration: string | null, known?: string | null): Operator {
  const cs = callsign ?? "";
  const prefix = cs.match(/^([A-Z]{3})\d/)?.[1];
  if (known?.startsWith("Private")) return { code: "GA", name: "Private / general aviation" };
  if (known) return { code: prefix ?? known.slice(0, 2).toUpperCase(), name: known };
  if (prefix && AIRLINES[prefix]) return { code: prefix, name: AIRLINES[prefix] };
  const isTail = /^N\d/.test(cs) || (registration != null && cs === registration);
  if (isTail || (!cs && registration?.startsWith("N"))) return { code: "GA", name: "Private / general aviation" };
  return { code: prefix ?? "?", name: "Unknown operator" };
}

/** Stable hue per operator code so badges are distinguishable. */
export function badgeHue(code: string): number {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

const CATEGORY: Record<number, string> = {
  2: "Light", 3: "Small", 4: "Large", 5: "High-vortex large", 6: "Heavy",
  7: "High performance", 8: "Rotorcraft", 9: "Glider", 10: "Lighter than air",
  11: "Parachutist", 12: "Ultralight", 14: "Drone", 15: "Space vehicle",
  16: "Emergency vehicle", 17: "Service vehicle",
};

export const categoryLabel = (c: number | null) => (c != null ? CATEGORY[c] ?? null : null);
