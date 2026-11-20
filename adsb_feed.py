"""
Live aircraft around an airport (KBOS unless told otherwise) from a readsb-style
ADS-B API (adsb.fi by default).

adsb.fi, adsb.lol and similar aggregators all serve readsb's JSON format, so one
converter covers them. Switch providers with env vars (see .env.example):

  ADSB_URL      URL template with {lat} {lon} {nm}; default is adsb.fi open data
  ADSB_API_KEY  optional, sent as x-api-key (adsb.lol keys use this header)

poll_once() returns a snapshot in Flive's format (SI units, OpenSky-style field
names, see CLAUDE.md) or raises RateLimited when the provider says slow down.
"""
import os
import re
import threading
import time

import requests

KBOS_LAT, KBOS_LON = 42.3656, -71.0096
RADIUS_NM = 40
MIN_GAP_S = 1.2     # adsb.fi allows 1 request/s per IP: keep every poller (Logan + others) under it

DEFAULT_URL = "https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{nm}"
DEFAULT_HEX_URL = "https://opendata.adsb.fi/api/v2/hex/{hex}"   # one aircraft, same JSON format
USER_AGENT = "Flive/0.1 (live airport traffic tracker; +https://github.com/thakurnilesh307/Flive)"

FT_TO_M = 0.3048
KT_TO_MS = 0.514444
FPM_TO_MS = 0.00508

_session = requests.Session()
_session.headers["User-Agent"] = USER_AGENT


class RateLimited(Exception):
    """Provider returned 429. retry_after is seconds, or None if not given."""
    def __init__(self, retry_after=None):
        super().__init__(f"rate limited (retry after {retry_after}s)")
        self.retry_after = retry_after


def _url(lat, lon, nm):
    template = os.getenv("ADSB_URL") or DEFAULT_URL
    return template.format(lat=lat, lon=lon, nm=nm)


_gap_lock = threading.Lock()
_last_request = 0.0


def _throttle():
    """Space requests from all pollers at least MIN_GAP_S apart (they run in threads)."""
    global _last_request
    with _gap_lock:
        wait = _last_request + MIN_GAP_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()


# --- field conversion -------------------------------------------------------

_SAFE = re.compile(r"[^A-Z0-9-]")


def _ident(value, maxlen=10):
    """Callsign / registration / type: provider data is untrusted, so keep only
    uppercase letters, digits and '-', and cap the length."""
    if not isinstance(value, str):
        return None
    cleaned = _SAFE.sub("", value.strip().upper())[:maxlen]
    return cleaned or None


def _num(value, scale=1.0):
    return value * scale if isinstance(value, (int, float)) else None


def _category(cat):
    """readsb emitter category ('A3') -> OpenSky number (4 = large).
    OpenSky: 0 no info, 1 no ADS-B category, A1-A7 = 2-8, B1-B7 = 9-15,
    C1-C5 = 16-20."""
    if not isinstance(cat, str) or len(cat) != 2 or not cat[1].isdigit():
        return 0
    letter, digit = cat[0], int(cat[1])
    if digit == 0:
        return 1
    offset = {"A": 1, "B": 8, "C": 15}.get(letter)
    if offset is None or (letter == "C" and digit > 5):
        return None
    return offset + digit


def _pos_source(kind):
    """readsb message type -> OpenSky position_source (0 ADS-B, 2 MLAT).
    TIS-B, Mode S and 'other' have no clean OpenSky equivalent -> None."""
    if not isinstance(kind, str):
        return None
    if kind.startswith(("adsb", "adsr", "adsc")):
        return 0
    if kind == "mlat":
        return 2
    return None


def convert(ac, api_time):
    alt_baro = ac.get("alt_baro")
    on_ground = alt_baro == "ground"
    seen_pos, seen = ac.get("seen_pos"), ac.get("seen")
    rate = ac.get("baro_rate", ac.get("geom_rate"))
    # Parked aircraft often send heading but no track; heading is a fine
    # stand-in for pointing the icon.
    track = ac.get("track", ac.get("true_heading"))
    squawk = ac.get("squawk")
    return {
        "icao24": str(ac.get("hex", "")).lower()[:7],
        "callsign": _ident(ac.get("flight"), 8),
        "lat": _num(ac.get("lat")),
        "lon": _num(ac.get("lon")),
        "baro_alt_m": None if on_ground else _num(alt_baro, FT_TO_M),
        "on_ground": on_ground,
        "velocity_ms": _num(ac.get("gs"), KT_TO_MS),
        "track_deg": _num(track),
        "vert_rate_ms": _num(rate, FPM_TO_MS),
        "geo_alt_m": _num(ac.get("alt_geom"), FT_TO_M),
        "squawk": squawk if isinstance(squawk, str) and squawk.isdigit() else None,
        "time_position": None if seen_pos is None else round(api_time - seen_pos, 3),
        "last_contact": None if seen is None else round(api_time - seen, 3),
        "pos_source": _pos_source(ac.get("type")),
        "category": _category(ac.get("category")),
        "aircraft_type": _ident(ac.get("t"), 4),
        "registration": _ident(ac.get("r"), 10),
    }


# --- polling ----------------------------------------------------------------

def poll_once(lat=KBOS_LAT, lon=KBOS_LON, nm=RADIUS_NM):
    headers = {}
    key = os.getenv("ADSB_API_KEY")
    if key:
        headers["x-api-key"] = key
    _throttle()
    r = _session.get(_url(lat, lon, nm), headers=headers, timeout=10)
    if r.status_code == 429:
        retry = r.headers.get("Retry-After")
        raise RateLimited(int(retry) if retry and retry.isdigit() else None)
    r.raise_for_status()
    data = r.json()
    fetched_at = time.time()
    now_ms = data.get("now")
    api_time = now_ms / 1000 if isinstance(now_ms, (int, float)) else fetched_at
    aircraft = [convert(ac, api_time) for ac in data.get("ac") or []]
    return {"fetched_at": fetched_at, "api_time": api_time, "aircraft": aircraft}


_HEX = re.compile(r"^[0-9a-f]{6}$")


def hex_url():
    """Single-aircraft URL template, or None when a custom provider has no such endpoint
    (ADSB_URL set without ADSB_HEX_URL): then the follow fast lane stays off."""
    custom = os.getenv("ADSB_HEX_URL")
    if custom:
        return custom
    return None if os.getenv("ADSB_URL") else DEFAULT_HEX_URL


def poll_hex(icao24):
    """One aircraft by its ICAO address: (converted aircraft or None, api_time).
    Shares the 1 request/s budget with the area pollers."""
    template = hex_url()
    if not template or not _HEX.match(icao24 or ""):
        return None, time.time()
    headers = {}
    key = os.getenv("ADSB_API_KEY")
    if key:
        headers["x-api-key"] = key
    _throttle()
    r = _session.get(template.format(hex=icao24), headers=headers, timeout=10)
    if r.status_code == 429:
        retry = r.headers.get("Retry-After")
        raise RateLimited(int(retry) if retry and retry.isdigit() else None)
    r.raise_for_status()
    data = r.json()
    now_ms = data.get("now")
    api_time = now_ms / 1000 if isinstance(now_ms, (int, float)) else time.time()
    for ac in data.get("ac") or []:
        a = convert(ac, api_time)
        if a["icao24"] == icao24 and a["lat"] is not None and a["lon"] is not None:
            return a, api_time
    return None, api_time


if __name__ == "__main__":
    # Quick manual check: one request, print a summary.
    snap = poll_once()
    print(f"{len(snap['aircraft'])} aircraft at {snap['api_time']:.0f}")
    for a in snap["aircraft"][:5]:
        print(a)
