"""
Derived traffic facts (distance, status, airline) from a snapshot, for the
server side (Ask Flive tools).

The status rules mirror frontend/src/status.ts so the chat and the map agree.
Both are placeholder heuristics until real arrival/departure detection
(roadmap step 4) replaces them; keep the two in sync until then.
"""
import math
import re

KBOS = (42.3656, -71.0096)
M_TO_FT = 3.28084
MS_TO_KT = 1.943844
MS_TO_FPM = 196.8504
EARTH_RADIUS_NM = 3440.065

STATUS_LABEL = {
    "approach": "on approach", "inbound": "inbound", "departing": "departing",
    "enroute": "en route", "taxiing": "taxiing", "ground": "on ground",
}

# Same table as frontend/src/airlines.ts.
AIRLINES = {
    "AAL": "American Airlines", "ABX": "ABX Air", "ACA": "Air Canada", "AFR": "Air France",
    "AMX": "Aeroméxico", "ASA": "Alaska Airlines", "AAY": "Allegiant Air", "AVA": "Avianca",
    "BAW": "British Airways", "CKS": "Kalitta Air", "CMP": "Copa Airlines", "CPA": "Cathay Pacific",
    "CPZ": "Compass Airlines", "DAL": "Delta Air Lines", "DLH": "Lufthansa", "EDV": "Endeavor Air",
    "EIN": "Aer Lingus", "EJA": "NetJets", "ELY": "El Al", "ENY": "Envoy Air", "ETD": "Etihad Airways",
    "FDX": "FedEx", "FFT": "Frontier Airlines", "GJS": "GoJet Airlines", "GTI": "Atlas Air",
    "IBE": "Iberia", "ICE": "Icelandair", "ITY": "ITA Airways", "JAL": "Japan Airlines",
    "JBU": "JetBlue", "JIA": "PSA Airlines", "JZA": "Air Canada Jazz", "KAL": "Korean Air",
    "KAP": "Cape Air", "KLM": "KLM", "LXJ": "Flexjet", "NKS": "Spirit Airlines", "PDT": "Piedmont Airlines",
    "POE": "Porter Airlines", "QTR": "Qatar Airways", "RPA": "Republic Airways", "SAS": "SAS",
    "SCX": "Sun Country", "SKW": "SkyWest Airlines", "SWA": "Southwest Airlines", "SWR": "Swiss",
    "TAP": "TAP Air Portugal", "THY": "Turkish Airlines", "TSC": "Air Transat", "UAE": "Emirates",
    "UAL": "United Airlines", "UPS": "UPS Airlines", "VIR": "Virgin Atlantic", "WJA": "WestJet",
}

COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def distance_nm(a, b):
    dlat, dlon = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlon / 2) ** 2)
    return 2 * EARTH_RADIUS_NM * math.asin(math.sqrt(h))


def bearing_deg(a, b):
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dlon = math.radians(b[1] - a[1])
    y = math.sin(dlon) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def angle_diff(a, b):
    """Smallest angle between two headings, 0-180."""
    return abs(((a - b) % 360 + 540) % 360 - 180)


UNSET = object()


def operator(callsign, registration, known=UNSET):
    """`known` = aircraft_db.enrich's answer (None means it looked and doesn't know)."""
    if known is not UNSET:
        if not known:
            return "Unknown operator"
        return "General aviation" if known.startswith("Private") else known
    cs = callsign or ""
    m = re.match(r"^([A-Z]{3})\d", cs)
    if m and m.group(1) in AIRLINES:
        return AIRLINES[m.group(1)]
    if re.match(r"^N\d", cs) or (registration and cs == registration) or (not cs and (registration or "").startswith("N")):
        return "General aviation"
    return "Unknown operator"


def classify(a, dist, alt, gs, vs, ref=KBOS):
    """Status relative to the airport at `ref` (Logan unless the live predictor for
    another airport asks); `dist` is the distance to that airport."""
    if a.get("on_ground"):
        return "taxiing" if gs is not None and gs > 5 else "ground"
    if dist is None:
        return "enroute"
    track = a.get("track_deg")
    off = angle_diff(track, bearing_deg((a["lat"], a["lon"]), ref)) if track is not None else None
    toward = off is not None and off < 45
    away = off is not None and off > 120
    descending = vs is not None and vs < -250
    climbing = vs is not None and vs > 250
    if dist < 15 and alt is not None and alt < 5000 and toward and (descending or alt < 2000):
        return "approach"
    if dist < 40 and descending and toward and (alt is None or alt < 18000):
        return "inbound"
    if dist < 25 and climbing and (away or dist < 5):
        return "departing"
    # Just lifted off: climb rate not built up yet, but low, at Logan and not descending.
    if dist < 5 and alt is not None and alt < 1500 and not descending:
        return "departing"
    return "enroute"


def _num(v):
    return v if isinstance(v, (int, float)) else None


def _mins(t, api_time):
    t = _num(t)
    return None if t is None or api_time is None else max(0, round((t - api_time) / 60))


def derive(a, api_time):
    """One aircraft -> flat dict in display units, ready to hand to the LLM."""
    lat, lon = _num(a.get("lat")), _num(a.get("lon"))
    has_pos = lat is not None and lon is not None
    dist = distance_nm((lat, lon), KBOS) if has_pos else None
    # alt_qnh_m: corrected for local air pressure (weather.py); fall back to raw pressure altitude.
    alt_m = _num(a.get("alt_qnh_m")) if _num(a.get("alt_qnh_m")) is not None else _num(a.get("baro_alt_m"))
    alt = None if a.get("on_ground") or alt_m is None else alt_m * M_TO_FT
    gs = None if _num(a.get("velocity_ms")) is None else a["velocity_ms"] * MS_TO_KT
    vs = None if _num(a.get("vert_rate_ms")) is None else a["vert_rate_ms"] * MS_TO_FPM
    status = classify(a, dist, alt, gs, vs) if has_pos else "enroute"
    side = COMPASS[round(bearing_deg(KBOS, (lat, lon)) / 45) % 8] if has_pos and dist and dist > 0.5 else None
    minutes = None
    if status in ("approach", "inbound") and gs and gs > 30 and dist is not None:
        minutes = round(dist / gs * 60, 1)
    seen = None if _num(a.get("last_contact")) is None else max(0, round(api_time - a["last_contact"]))
    return {
        "callsign": a.get("callsign"),
        "airline": operator(a.get("callsign"), a.get("registration"), a.get("operator", UNSET)),
        "aircraft_type": a.get("aircraft_type"),
        "aircraft_model": a.get("type_desc"),
        "registration": a.get("registration"),
        "icao24": a.get("icao24"),
        "status": STATUS_LABEL[status],
        "_status": status,
        "altitude_ft": None if alt is None else int(round(alt / 25) * 25),
        "on_ground": bool(a.get("on_ground")),
        "groundspeed_kt": None if gs is None else int(round(gs)),
        "vertical_speed_fpm": None if vs is None or a.get("on_ground") else int(round(vs / 10) * 10),
        "track_deg": None if _num(a.get("track_deg")) is None else int(round(a["track_deg"])) % 360,
        "distance_nm": None if dist is None else round(dist, 1),
        # Where the plane is now relative to Logan; NOT where it came from.
        "current_position": f"{side} of KBOS" if side else ("at KBOS" if has_pos else None),
        # Named so the model can't easily mistake it for an ETA.
        "earliest_possible_minutes_to_kbos": minutes,
        # Landing-time model (eta.py): minutes from the data time, or None.
        "_predicted_min": _mins(a.get("landing_at"), api_time),
        "_predicted_lo_min": _mins(a.get("landing_lo_at"), api_time),
        "_predicted_hi_min": _mins(a.get("landing_hi_at"), api_time),
        # Runway models (train_runway.py): runway + probability, or None.
        "_landing_runway": a.get("landing_runway"),
        "_landing_runway_p": a.get("landing_runway_p"),
        "_takeoff_runway": a.get("takeoff_runway"),
        "_takeoff_runway_p": a.get("takeoff_runway_p"),
        "squawk": a.get("squawk"),
        "seconds_since_signal": seen,
    }


def derive_all(snapshot):
    if not snapshot:
        return []
    rows = [derive(a, snapshot["api_time"]) for a in snapshot.get("aircraft", [])]
    rows.sort(key=lambda r: r["distance_nm"] if r["distance_nm"] is not None else 999)
    return rows
